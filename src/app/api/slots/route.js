import { NextResponse } from 'next/server';

// In-memory store as fallback
const memoryStore = { booked: [] };

async function getBookedSlots() {
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
        try {
            const resp = await fetch(`${process.env.KV_REST_API_URL}/get/booked_slots`, {
                headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
            });
            const data = await resp.json();
            return data.result ? JSON.parse(data.result) : [];
        } catch (e) {
            console.error('KV read error:', e);
            return memoryStore.booked;
        }
    }
    return memoryStore.booked;
}

export async function GET() {
    try {
        const booked = await getBookedSlots();
        return NextResponse.json({ booked });
    } catch (e) {
        console.error('Slots error:', e);
        return NextResponse.json({ booked: [] });
    }
}
