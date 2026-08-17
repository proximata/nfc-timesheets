import type { ReactNode } from 'react'

export type PageHeaderProps = {
  title: string
  /**
   * The question this screen answers, in the user's language: „Muss ich gerade etwas tun?"
   * Not decoration. A screen that cannot state its question has not been redesigned, and the
   * reviewer's test is whether they can answer it from the top ~400px.
   */
  question: string
  /** At most ONE primary action. Two primary buttons on a screen means neither is primary. */
  action?: ReactNode
}

/** `<h1>`, the question under it, and the screen's one action. 13 callers. */
export function PageHeader({ title, question, action }: PageHeaderProps) {
  return (
    <div className="topline">
      <div>
        <h1>{title}</h1>
        <p className="question">{question}</p>
      </div>
      {action ? <div className="topline-action">{action}</div> : null}
    </div>
  )
}
