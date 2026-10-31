// Lets the plain-node tests load src/lib files that import each other without a file extension
// (as Next resolves them): "./daily" is tried as "./daily.ts".
import { register } from 'node:module'

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context)
  } catch (error) {
    if (specifier.startsWith('.') && !/\\.[a-z]+$/.test(specifier)) return next(specifier + '.ts', context)
    throw error
  }
}`), import.meta.url)
