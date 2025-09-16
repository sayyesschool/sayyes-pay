import supabase from '@/lib/supabase/client';

export async function signIn({ email }) {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_VERCEL_URL || (typeof window !== 'undefined' ? window.location.origin : '');
    const redirectTo = `${baseUrl}/dashboard`;

    const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo }
    });

    if (error) {
        throw error;
    }
}

export function signOut() {
    return supabase.auth.signOut();
}