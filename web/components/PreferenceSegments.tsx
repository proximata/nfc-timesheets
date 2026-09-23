'use client'

import { type ReactNode, useId } from 'react'

/** Native radio groups keep arrow-key navigation and checked state without custom focus code. */
export function PreferenceSegments<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly { value: T; label: string; content: ReactNode }[]
  onChange: (value: T) => void
}) {
  const name = useId()
  return (
    <fieldset className="preference-switcher">
      <legend className="visually-hidden">{label}</legend>
      {options.map((option) => (
        <label key={option.value} className="preference-segment" title={option.label}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            aria-label={option.label}
            onChange={() => onChange(option.value)}
          />
          <span>{option.content}</span>
        </label>
      ))}
    </fieldset>
  )
}
