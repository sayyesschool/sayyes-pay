/**
 * SayYes: синхронизация Google Ads с настройками на сайте.
 *
 * Источник правды: https://www.sayyestoenglish.com/gads/config.json (правит Claude через git).
 * Скрипт раз в час приводит кампанию к этим настройкам и шлёт отчёт на сайт.
 *
 * Что меняет: страны, языки, бюджет, ключевые фразы (добавляет, лишние ставит на паузу),
 * минус-слова кампании.
 * Чего НЕ делает никогда: не включает и не выключает кампании, группы и объявления,
 * не трогает ставки и объявления. Включение и выключение остаётся за Димой.
 */

var CONFIG_URL = 'https://www.sayyestoenglish.com/gads/config.json';
var REPORT_URL = 'https://www.sayyestoenglish.com/api/gads/report';
var REPORT_KEY = '__KEY__';

function main() {
  var changes = [];
  var errors = [];
  var cfg;

  try {
    cfg = JSON.parse(UrlFetchApp.fetch(CONFIG_URL + '?t=' + Date.now(), { muteHttpExceptions: false }).getContentText());
  } catch (e) {
    Logger.log('Не удалось прочитать настройки: ' + e);
    return;
  }

  var dry = cfg.dryRun === true || AdsApp.getExecutionInfo().isPreview();
  var it = AdsApp.campaigns().withCondition("campaign.name = '" + cfg.campaign + "'").get();

  if (!it.hasNext()) {
    report(cfg, [], ['Кампания не найдена: ' + cfg.campaign], null, []);
    return;
  }

  var campaign = it.next();
  var customerId = AdsApp.currentAccount().getCustomerId().replace(/-/g, '');
  var campaignRes = 'customers/' + customerId + '/campaigns/' + campaign.getId();

  // --- Страны ---
  try {
    var geo = {};
    var g = AdsApp.search("SELECT geo_target_constant.id, geo_target_constant.country_code FROM geo_target_constant " +
      "WHERE geo_target_constant.target_type = 'Country' AND geo_target_constant.status = 'ENABLED'");
    while (g.hasNext()) {
      var row = g.next();
      geo[row.geoTargetConstant.countryCode] = String(row.geoTargetConstant.id);
    }
    var wantIds = [];
    (cfg.countries || []).forEach(function (cc) {
      if (geo[cc]) wantIds.push(geo[cc]); else errors.push('Нет страны в Google: ' + cc);
    });
    var have = {};
    var locs = campaign.targeting().targetedLocations().get();
    while (locs.hasNext()) {
      var l = locs.next();
      have[String(l.getId())] = l;
    }
    wantIds.forEach(function (id) {
      if (!have[id]) {
        if (!dry) campaign.addLocation(Number(id));
        changes.push('+страна ' + id);
      }
    });
    Object.keys(have).forEach(function (id) {
      if (wantIds.indexOf(id) < 0) {
        if (!dry) have[id].remove();
        changes.push('-страна ' + id);
      }
    });
  } catch (e) { errors.push('Страны: ' + e); }

  // --- Языки: "all" = без ограничений, иначе список кодов (ru, en, de...) ---
  try {
    var langNow = {};
    var lq = AdsApp.search("SELECT campaign_criterion.resource_name, campaign_criterion.language.language_constant " +
      "FROM campaign_criterion WHERE campaign.id = " + campaign.getId() + " AND campaign_criterion.type = 'LANGUAGE'");
    while (lq.hasNext()) {
      var lr = lq.next();
      langNow[lr.campaignCriterion.language.languageConstant] = lr.campaignCriterion.resourceName;
    }
    var langWant = [];
    if (cfg.languages !== 'all') {
      var codes = {};
      var lc = AdsApp.search('SELECT language_constant.resource_name, language_constant.code FROM language_constant');
      while (lc.hasNext()) {
        var c = lc.next();
        codes[c.languageConstant.code] = c.languageConstant.resourceName;
      }
      (cfg.languages || []).forEach(function (code) {
        if (codes[code]) langWant.push(codes[code]); else errors.push('Нет языка: ' + code);
      });
    }
    Object.keys(langNow).forEach(function (lang) {
      if (langWant.indexOf(lang) < 0) {
        if (!dry) AdsApp.mutate({ campaignCriterionOperation: { remove: langNow[lang] } });
        changes.push('-язык ' + lang);
      }
    });
    langWant.forEach(function (lang) {
      if (!langNow[lang]) {
        if (!dry) AdsApp.mutate({ campaignCriterionOperation: { create: { campaign: campaignRes, language: { languageConstant: lang } } } });
        changes.push('+язык ' + lang);
      }
    });
  } catch (e) { errors.push('Языки: ' + e); }

  // --- Бюджет ---
  try {
    var budget = campaign.getBudget();
    if (cfg.dailyBudget && Math.abs(budget.getAmount() - cfg.dailyBudget) > 0.001) {
      if (!dry) budget.setAmount(cfg.dailyBudget);
      changes.push('бюджет ' + budget.getAmount() + ' -> ' + cfg.dailyBudget);
    }
  } catch (e) { errors.push('Бюджет: ' + e); }

  // --- Ключевые фразы ---
  (cfg.adGroups || []).forEach(function (agCfg) {
    try {
      // "*" = все группы кампании (у нас одна).
      var agIt = agCfg.name === '*' ? campaign.adGroups().get()
        : campaign.adGroups().withCondition("ad_group.name = '" + agCfg.name + "'").get();
      if (!agIt.hasNext()) { errors.push('Нет группы: ' + agCfg.name); return; }
      while (agIt.hasNext()) syncAdGroup(agIt.next(), agCfg);
    } catch (e) { errors.push('Фразы ' + agCfg.name + ': ' + e); }
  });

  function syncAdGroup(ag, agCfg) {
    try {
      var wrap = function (t) { return agCfg.match === 'exact' ? '[' + t + ']' : agCfg.match === 'broad' ? t : '"' + t + '"'; };
      var want = agCfg.keywords.map(function (t) { return bare(t); });
      var existing = {};
      var ks = ag.keywords().withCondition("ad_group_criterion.status != 'REMOVED'").get();
      while (ks.hasNext()) {
        var k = ks.next();
        existing[bare(k.getText())] = k;
      }
      want.forEach(function (t) {
        if (!existing[t]) {
          if (!dry) ag.newKeywordBuilder().withText(wrap(t)).build();
          changes.push('+фраза ' + t);
        } else if (existing[t].isPaused()) {
          if (!dry) existing[t].enable();
          changes.push('вкл фраза ' + t);
        }
      });
      if (agCfg.pauseExtraKeywords !== false && cfg.pauseExtraKeywords) {
        Object.keys(existing).forEach(function (t) {
          if (want.indexOf(t) < 0 && existing[t].isEnabled()) {
            if (!dry) existing[t].pause();
            changes.push('пауза фраза ' + t);
          }
        });
      }
    } catch (e) { errors.push('Фразы ' + ag.getName() + ': ' + e); }
  }

  // --- Минус-слова кампании ---
  try {
    // Сравниваем по тексту без кавычек и скобок: Google отдаёт тип соответствия отдельно.
    var negRaw = {};
    (cfg.negativeKeywords || []).forEach(function (t) { negRaw[bare(t)] = t; });
    var negWant = Object.keys(negRaw);
    var negHave = {};
    var ns = campaign.negativeKeywords().get();
    while (ns.hasNext()) {
      var n = ns.next();
      negHave[bare(n.getText())] = n;
    }
    negWant.forEach(function (t) {
      if (!negHave[t]) {
        if (!dry) campaign.createNegativeKeyword(negRaw[t]);
        changes.push('+минус ' + t);
      }
    });
    if (cfg.removeExtraNegatives) {
      Object.keys(negHave).forEach(function (t) {
        if (negWant.indexOf(t) < 0) {
          if (!dry) negHave[t].remove();
          changes.push('-минус ' + t);
        }
      });
    }
  } catch (e) { errors.push('Минус-слова: ' + e); }

  // --- Статистика и поисковые запросы за 7 дней ---
  var stats = null;
  var terms = [];
  try {
    var s = campaign.getStatsFor('LAST_7_DAYS');
    stats = {
      status: campaign.isEnabled() ? 'enabled' : (campaign.isPaused() ? 'paused' : 'other'),
      impressions: s.getImpressions(),
      clicks: s.getClicks(),
      cost: s.getCost(),
      conversions: s.getConversions(),
      avgCpc: s.getAverageCpc()
    };
    var q = AdsApp.search('SELECT search_term_view.search_term, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions ' +
      'FROM search_term_view WHERE campaign.id = ' + campaign.getId() + ' AND segments.date DURING LAST_7_DAYS ' +
      'ORDER BY metrics.impressions DESC LIMIT 100');
    while (q.hasNext()) {
      var r = q.next();
      terms.push({
        term: r.searchTermView.searchTerm,
        impressions: Number(r.metrics.impressions || 0),
        clicks: Number(r.metrics.clicks || 0),
        cost: Number(r.metrics.costMicros || 0) / 1e6,
        conversions: Number(r.metrics.conversions || 0)
      });
    }
  } catch (e) { errors.push('Статистика: ' + e); }

  report(cfg, changes, errors, stats, terms, dry);
}

function bare(t) {
  return String(t).toLowerCase().replace(/^[\s"\[+]+|[\s"\]]+$/g, '').replace(/\s+/g, ' ');
}

function report(cfg, changes, errors, stats, terms, dry) {
  var body = {
    version: cfg && cfg.version,
    dryRun: !!dry,
    changes: changes,
    errors: errors,
    stats: stats,
    searchTerms: terms
  };
  Logger.log(JSON.stringify(body, null, 1));
  try {
    UrlFetchApp.fetch(REPORT_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-gads-key': REPORT_KEY },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
  } catch (e) {
    Logger.log('Отчёт не отправлен: ' + e);
  }
}
