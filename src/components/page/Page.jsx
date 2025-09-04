import Header from '@/components/header';

export default function Page({ user, auth, children }) {
    return (<>
        <Header user={user} />

        <main className="main">
            {user || !auth
                ? children
                : (
                    <div className="card">
                        <h2>Требуется вход</h2>
                        <p><a href="/login">Войдите</a>, чтобы видеть свои покупки.</p>
                    </div>
                )}
        </main>
    </>);
}