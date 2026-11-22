import { PRODUCTS } from '@/lib/products'
import { NavDropdown } from './NavDropdown'

/** "Products" dropdown for the landing page nav. Items come from `PRODUCTS`. */
export function ProductsMenu() {
  return <NavDropdown label="Products" items={PRODUCTS} />
}
