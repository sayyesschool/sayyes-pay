import supabase from '@/lib/supabase/service';

export async function getPurchases({ email } = {}) {
    const { data = [], error } = await supabase
        .from('purchases')
        .select('*')
        .eq('email', email)
        .order('created_at', { ascending: false });

    if (error) throw error;

    return data;
}

export async function createPurchase(data) {
    const purchase = await supabase.from('purchases').insert(data);

    return purchase.data;
}