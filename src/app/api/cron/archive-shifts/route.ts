import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js'
import { rejectUnauthorizedCron } from '@/lib/server/cron-auth';

// Vercel Cron will hit this endpoint
export async function GET(request: Request) {
  const rejected = rejectUnauthorizedCron(request)
  if (rejected) return rejected

  // Initialize Supabase admin client to bypass RLS
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    // Call the RPC function to archive unfilled shifts past 12 PM local time (Eastern Time)
    const { data: updatedCount, error } = await supabase.rpc('archive_unfilled_shifts');

    if (error) {
      console.error('Error archiving shifts:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `Successfully archived ${updatedCount || 0} unfilled shifts.`,
    });
  } catch (err: any) {
    console.error('Unexpected error archiving shifts:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
