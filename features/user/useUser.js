import { useEffect, useState } from 'react';

import supabase from '@/lib/supabase/client';

export function useUser() {
    const [user, setUser] = useState(null);

    useEffect(() => {
        console.log('GET USER');
        supabase.auth.getUser().then(({ data }) => setUser(data.user || null));

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_evt, session) => {
            setUser(session?.user ?? null);
        });

        return () => subscription?.unsubscribe?.();
    }, []);

    return user;
}