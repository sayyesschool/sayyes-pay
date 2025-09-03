import supabase from '@/lib/supabase/service';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email');

  if (!email) {
    return new Response(JSON.stringify({ error: 'email required' }), { status: 400 });
  }

  const { data, error } = await supabase
    .from('purchases')
    .select('*')
    .eq('email', email)
    .order('created_at', { ascending: false });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ purchases: data || [] }), { status: 200 });
}
