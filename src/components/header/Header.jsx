import Link from 'next/link';

import { redirect } from 'next/navigation';

import { signOut } from '@/features/user/client';

import './Header.scss';

export default function Header({ user }) {
    async function logout() {
        await signOut();
        return redirect('/login');
    }

    return (
        <header className="header header--blurred">
            <div className="header__main">
                <div className="header__container">
                    <a className="header__logo logo" href="/">
                        <img src="https://s3.regru.cloud/sayyes-static/images/logos/sayyes-english-school_purple.svg" alt="Логотип Say Yes" />
                    </a>

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
                    </nav>
                </div>
            </div>
        </header>
    );
}