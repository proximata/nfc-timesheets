'use client'

import { useTranslations } from 'next-intl'
import { cloneElement, isValidElement, type ReactNode } from 'react'

/** The subset of the control's props this wires up. */
type ControlProps = {
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}

export type FieldProps = {
  /** Also the control's id, the help text's `${id}-help` and the error's `${id}-error`. */
  id: string
  label: string
  /** Renders a visible `*`. Put `required` on the control itself as well — that is what
   *  announces it. Do NOT add `aria-required` next to a native `required`; Biome rejects it. */
  required?: boolean
  /** Renders the word "optional". Not the same as "unbeschriftet": a field that may be left
   *  empty says so, because a form of unmarked fields reads as a form of mandatory ones. */
  optional?: boolean
  help?: ReactNode
  /** Truthy → the control gets aria-invalid and this text is announced with it. */
  error?: ReactNode
  /** ONE element: an <input>, <select> or <textarea>. */
  children: ReactNode
}

/**
 * Label ↔ control association, the required/optional marker, and the aria-describedby wiring
 * for help and error text. ~11 callers, and the wiring is the reason it is a component: a
 * hand-rolled eleventh copy is where the describedby goes missing.
 *
 * The error paragraph is ALWAYS in the DOM, empty when there is nothing to say. An element
 * removed from the accessibility tree is not a live region, and a text change inside an
 * existing node is announced far more reliably than a node that blinks into existence. That
 * rule is written in six files in this repo already; it does not change here.
 *
 * The child is cloned so `id`, `aria-describedby` and `aria-invalid` land on the real
 * control. A child that already sets one of them keeps its own value, and an existing
 * `aria-describedby` is merged rather than replaced.
 */
export function Field({ id, label, required, optional, help, error, children }: FieldProps) {
  const t = useTranslations('field')
  const helpId = help ? `${id}-help` : undefined
  const errorId = `${id}-error`
  const describedBy = [helpId, errorId].filter(Boolean).join(' ')

  const control = isValidElement<ControlProps>(children)
    ? cloneElement(children, {
        id: children.props.id ?? id,
        'aria-describedby': [children.props['aria-describedby'], describedBy]
          .filter(Boolean)
          .join(' '),
        'aria-invalid': children.props['aria-invalid'] ?? (error ? true : undefined),
      })
    : children

  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required ? (
          <span className="req" aria-hidden="true">
            *
          </span>
        ) : null}
        {optional ? <span className="opt">{t('optional')}</span> : null}
      </label>
      {control}
      {help ? (
        <p className="field-hint" id={helpId}>
          {help}
        </p>
      ) : null}
      <p className="field-error" id={errorId}>
        {error}
      </p>
    </div>
  )
}
