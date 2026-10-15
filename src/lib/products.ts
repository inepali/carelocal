import { Clock, Monitor, ShoppingCart, type LucideIcon } from 'lucide-react'

export interface Product {
  name: string
  tagline: string
  href: string
  Icon: LucideIcon
  comingSoon?: boolean
}

/**
 * Products shown in the marketing site's "Products" menu.
 * Add a product here and it appears on every vertical's landing page.
 * `href` is an internal path or a full URL (external sites open in a new tab).
 */
export const PRODUCTS: Product[] = [
  {
    name: 'CareDisplay',
    tagline: 'Digital displays for schedules and announcements at your center',
    href: 'https://caredisplay.carelocal.net',
    Icon: Monitor,
  },
  {
    name: 'CareTime',
    tagline: 'Staff time tracking and attendance',
    href: 'https://purple-snake-685383.hostingersite.com/',
    Icon: Clock,
  },
  {
    name: 'PurchApp',
    tagline: 'Purchasing and supply ordering for your team',
    href: 'https://purchapp.net',
    Icon: ShoppingCart,
  },
]
