import { redirect } from 'next/navigation'

// Work areas (Classrooms / Care Areas …) are now managed in Manage Data; keep old links working.
export default function SectionsRedirect() {
  redirect('/center/settings/data?tab=work_areas')
}
