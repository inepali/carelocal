import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kfjpsucszngvsnacjscq.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmanBzdWNzem5ndnNuYWNqc2NxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5NjM5NjIsImV4cCI6MjA5MTUzOTk2Mn0.gFy0P-2A4YO3TgGOkhYXtPheXTP0DuQ6wcunftAELc0'
  )
}
