import Link from 'next/link';

export default function Layout({ children, user }) {
    return (
        <div className="container">
            <header className="header">
                <img src="/logo.svg" width="56" height="56" />

                <h1>Доступ к материалам</h1>

                <p>Войдите и оплачивайте. История покупок в кабинете.</p>

                <nav style={{ marginTop: 10 }}>
                    <Link href="/">Главная</Link>{' | '}
                    <Link href="/dashboard">Личный кабинет</Link>{' | '}
                    <Link href="/login">{user ? 'Сменить аккаунт' : 'Вход'}</Link>
                </nav>
            </header>

            {children}
        </div>
    );
}
