/**
 * App-styled replacements for the browser's alert() / confirm() / prompt().
 * Callable from anywhere on the client (components, handlers, lib code); the <DialogHost />
 * mounted in the root layout renders them as modals.
 *
 *   showAlert('Saved')                              // fire and forget
 *   if (!await showConfirm('Delete this?')) return  // resolves true / false
 *   const name = await showPrompt('Template name')  // resolves string, or null when cancelled
 */

export type DialogTone = 'default' | 'danger' | 'error'

export type DialogRequest =
  | { kind: 'alert'; message: string; title?: string; tone: DialogTone; resolve: () => void }
  | { kind: 'confirm'; message: string; title?: string; tone: DialogTone; confirmLabel?: string; resolve: (ok: boolean) => void }
  | { kind: 'prompt'; message: string; title?: string; tone: DialogTone; defaultValue: string; resolve: (value: string | null) => void }

type Listener = (request: DialogRequest) => void

let listener: Listener | null = null
const pending: DialogRequest[] = []

export function subscribeDialogs(fn: Listener) {
  listener = fn
  // Anything requested before the host mounted is shown now
  while (pending.length) fn(pending.shift()!)
  return () => { if (listener === fn) listener = null }
}

function dispatch(request: DialogRequest) {
  if (listener) listener(request)
  else pending.push(request)
}

const ERROR_WORDS = /\b(fail(ed|ure)?|error|invalid|cannot|can't|unable|not allowed|denied|wrong|required)\b/i
const DANGER_WORDS = /\b(delete|remove|decline|cancel|discard|permanently)\b/i

export interface DialogOptions { title?: string; tone?: DialogTone; confirmLabel?: string }

export function showAlert(message: unknown, options: DialogOptions = {}): Promise<void> {
  const text = typeof message === 'string' ? message : message == null ? '' : String(message)
  return new Promise(resolve => dispatch({
    kind: 'alert', message: text, title: options.title,
    tone: options.tone ?? (ERROR_WORDS.test(text) ? 'error' : 'default'), resolve,
  }))
}

export function showConfirm(message: string, options: DialogOptions = {}): Promise<boolean> {
  return new Promise(resolve => dispatch({
    kind: 'confirm', message, title: options.title, confirmLabel: options.confirmLabel,
    tone: options.tone ?? (DANGER_WORDS.test(message) ? 'danger' : 'default'), resolve,
  }))
}

export function showPrompt(message: string, defaultValue = '', options: DialogOptions = {}): Promise<string | null> {
  return new Promise(resolve => dispatch({
    kind: 'prompt', message, title: options.title, defaultValue, tone: options.tone ?? 'default', resolve,
  }))
}
