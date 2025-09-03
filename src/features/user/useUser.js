import { useEffect, useRef, useState } from 'react';

import supabase from '@/lib/supabase/client';

export function useUser() {
    const [user, setUser] = useState(null);
    const loadingRef = useRef(false);

    useEffect(() => {
        if (user || loadingRef.current) return;

        loadingRef.current = true;
        supabase.auth.getUser().then(({ data }) => {
            setUser(data.user || null);
        }).finally(() => {
            loadingRef.current = false;
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_evt, session) => {
            setUser(session?.user ?? null);
        });

        return () => subscription?.unsubscribe?.();
    }, [user]);

    return user;
}