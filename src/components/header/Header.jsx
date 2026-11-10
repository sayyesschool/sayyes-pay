import './Header.scss';

export default function Header({ user }) {
    return (
        <header className="header header--blurred">
            <div className="header__main">
                <div className="header__container">
                    <a className="header__logo logo" href="/">
                        {/* 10.11.2026: хранилище s3.regru.cloud (/static/*) перестало отдавать файлы, логотип берём со старого сайта через /wp/. */}
                        <img src="/wp/themes/sayyes/static/images/logo-purple.svg" alt="Логотип Say Yes" />
                    </a>
                    {/* 
                    <nav className="header__buttons">
                        <Link href="/" className="btn btn--sm btn--transparent btn--uppercase">Главная</Link>

                        {user &&
                            <Link href="/dashboard" className="btn btn--sm btn--transparent btn--uppercase">Личный кабинет</Link>
                        }

                        {user ? (
                            <button className="btn btn--sm btn--transparent btn--uppercase" onClick={logout}>Выйти</button>
                        ) : (
                            <Link href="/login" className="btn btn--sm btn--transparent btn--uppercase">Вход</Link>
                        )}
                    </nav> */}
                </div>
            </div>
        </header>
    );
}
