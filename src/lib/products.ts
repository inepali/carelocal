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
 * Point `href` at the product's page/site once it exists.
 */
export const PRODUCTS: Product[] = [
  {
    name: 'CareDisplay',
    tagline: 'Digital displays for schedules and announcements at your center',
    href: '/contact',
    Icon: Monitor,
  },
  {
    name: 'CareTime',
    tagline: 'Staff time tracking and attendance',
    href: '/contact',
    Icon: Clock,
  },
  {
    name: 'PurchApp',
    tagline: 'Purchasing and supply ordering for your team',
    href: '/contact',
    Icon: ShoppingCart,
  },
]
