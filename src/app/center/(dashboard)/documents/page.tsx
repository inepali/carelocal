import { redirect } from 'next/navigation'

// Document Requirements now live in the About page; keep old links working.
export default function DocumentsRedirect() {
  redirect('/center/about#documents')
}
