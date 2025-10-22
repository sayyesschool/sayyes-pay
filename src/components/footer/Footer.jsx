import './Footer.scss';

const year = new Date().getFullYear();

export default function Footer() {
    return (
        <footer className="footer">
            <div className="footer__container">
                <div className="footer__social flex justify-center">
                    <ul className="social">
                        <li className="social__item">
                            <a className="social__link" href="https://t.me/sayyes2english" target="_blank">
                                <span className="icon icon--telegram">
                                    <svg width="20" height="20" viewBox="0 0 23 19" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M22.886 1.704c-.31 3.236-1.651 11.09-2.334 14.715-.288 1.533-.857 2.048-1.407 2.098-1.197.11-2.105-.785-3.263-1.54-1.813-1.181-2.838-1.916-4.597-3.068-2.034-1.332-.716-2.064.443-3.26.304-.313 5.574-5.077 5.676-5.509.013-.054.025-.256-.096-.362-.12-.105-.298-.07-.426-.04-.182.04-3.078 1.942-8.689 5.705-.822.561-1.566.835-2.233.82-.736-.015-2.15-.413-3.202-.753-1.29-.416-2.315-.637-2.226-1.344.046-.369.557-.746 1.532-1.13 6.005-2.6 10.009-4.314 12.012-5.142C19.796.529 20.986.119 21.76.105c.17-.003.551.04.798.238a.86.86 0 01.293.554c.042.267.054.538.035.807z" fill="currentColor" />
                                    </svg>
                                </span>
                            </a>
                        </li>

                        <li className="social__item">
                            <a className="social__link" href="https://www.youtube.com/channel/UCK4utZpkwhJhGD75B_ZSkDg" target="_blank">
                                <span className="icon icon--youtube">
                                    <svg width="20" height="20" viewBox="0 0 24 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path fillRule="evenodd" clipRule="evenodd" d="M23.344 2.576c-.273-.974-1.076-1.74-2.095-1.998C19.402.105 12 .105 12 .105s-7.406 0-9.253.473C1.727.837.926 1.602.653 2.576c-.495 1.76-.495 5.44-.495 5.44s0 3.676.495 5.44c.273.97 1.075 1.707 2.094 1.966 1.847.473 9.253.473 9.253.473s7.407 0 9.254-.473c1.019-.26 1.82-.995 2.094-1.966.494-1.764.494-5.44.494-5.44s-.004-3.68-.498-5.44zM9.576 4.677v6.678l6.192-3.339-6.192-3.339z" fill="currentColor" />
                                    </svg>
                                </span>
                            </a>
                        </li>
                    </ul>
                </div>

                <div className="footer__copyright list gap-xs">
                    <small>© {year} SAY&nbsp;YES!</small>
                    <small>Все права защищены</small>
                </div>

                <div className="footer__legal">
                    <ul className="flex flex-wrap justify-center gap-s">
                        <li className="list-item"><a className="link" href="/legal/widerrufsrecht">Widerrufsrecht <br /> <span className="text--muted text--small">Право на отзыв</span></a></li>
                        <li className="list-item"><a className="link" href="/legal/haftungsausschluss">Haftungsausschluss <br /> <span className="text--muted text--small">Отказ от ответственности</span></a></li>
                        <li className="list-item"><a className="link" href="/legal/datenschutzerklarung">Datenschutzerklärung <br /> <span className="text--muted text--small">Политика конфиденциальности</span></a></li>
                        <li className="list-item"><a className="link" href="/legal/agb">AGB – Allgemeine Geschäftsbedingungen <br /> <span className="text--muted text--small">Общие условия оказания услуг</span></a></li>
                        <li className="list-item"><a className="link" href="/legal/cookie-richtlinie">Cookie-Richtlinie <br /> <span className="text--muted text--small">Политика использования cookies услуг</span></a></li>
                    </ul>
                </div>
            </div>
        </footer>
    );
}