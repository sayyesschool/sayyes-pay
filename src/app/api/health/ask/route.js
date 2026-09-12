import { NextResponse } from 'next/server';

// Проверка, что помощнику есть чем думать. Наружу — только факт работоспособности
// и текст ошибки: ни ключа, ни данных школы здесь нет.
export const dynamic = 'force-dynamic';

export async function GET() {
  const key = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

  if (!key) return NextResponse.json({ hasKey: false, ok: false, reason: 'Нет ANTHROPIC_API_KEY' });

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        ...(process.env.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID } : {})
      },
      body: JSON.stringify({
        model,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Ответь одним словом: ок' }]
      })
    });

    const data = await resp.json();

    if (!resp.ok) {
      return NextResponse.json({
        hasKey: true,
        ok: false,
        model,
        reason: (data.error && data.error.message) || ('HTTP ' + resp.status)
      });
    }

    return NextResponse.json({ hasKey: true, ok: true, model, workspace: Boolean(process.env.ANTHROPIC_WORKSPACE_ID) });
  } catch (e) {
    return NextResponse.json({ hasKey: true, ok: false, model, reason: e.message });
  }
}
