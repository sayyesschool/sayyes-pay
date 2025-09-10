"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import UserContext from './UserContext';

import supabase from '@/lib/supabase/client';

export default function UserProvider({ children }) {
    const [user, setUser] = useState(undefined);

    const loadingRef = useRef(false);

    useEffect(() => {
        if (user || loadingRef.current) return;

        loadingRef.current = true;

        supabase.auth.getUser()
            .then(({ data }) => {
                setUser(data.user || null);
            }).finally(() => {
                loadingRef.current = false;
            });

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_evt, session) => {
            setUser(session?.user ?? null);
        });

        return () => subscription?.unsubscribe?.();
    }, [user]);

    const value = useMemo(() => ({ user }), [user]);

    return (
        <UserContext.Provider value={value}>
            {children}
        </UserContext.Provider>
    );
}