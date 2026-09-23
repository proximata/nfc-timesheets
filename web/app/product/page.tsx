'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { type FormEvent, useState } from 'react'
import { useLocaleSetting } from '@/components/IntlProvider'
import { MicrosoftPlaceholder } from '@/components/MicrosoftPlaceholder'
import { ApiError, apiFetch } from '@/lib/api'
import { LOGIN_PATH } from '@/lib/nav'
import './product.css'

type TrialState = 'idle' | 'sending' | 'success' | 'invalid' | 'limited' | 'error'

function TapStory() {
  const t = useTranslations('landing')
  const [paused, setPaused] = useState(false)
  return (
    <div className="landing-story" data-paused={paused}>
      <button
        type="button"
        className="landing-animation-toggle"
        onClick={() => setPaused(!paused)}
        aria-pressed={paused}
      >
        {t(paused ? 'animationPlay' : 'animationPause')}
      </button>
      <div className="landing-story-grain" aria-hidden="true" />
      <div className="landing-story-caption" aria-hidden="true">
        <span className="landing-story-caption-dot" />
        {t('visualCaption')}
      </div>
      <svg
        className="landing-story-art"
        viewBox="0 0 640 480"
        fill="none"
        role="img"
        aria-label={t('visualDescription')}
      >
        <ellipse cx="320" cy="401" rx="255" ry="16" fill="#102E2C" opacity=".2" />
        <g className="landing-building">
          <rect x="65" y="116" width="190" height="278" rx="12" fill="#E6E9DA" />
          <path d="M65 165H255M65 242H255" stroke="#CDD7C6" strokeWidth="3" />
          <rect x="84" y="183" width="50" height="43" rx="4" fill="#9FBEAD" />
          <rect x="151" y="183" width="50" height="43" rx="4" fill="#9FBEAD" />
          <rect x="85" y="263" width="91" height="131" rx="6" fill="#26534A" />
          <path d="M130 272V388" stroke="#83A99A" strokeWidth="2" />
          <circle cx="141" cy="326" r="3" fill="#E6E9DA" />
          <rect x="207" y="266" width="28" height="34" rx="7" fill="#153E36" />
          <path
            d="M213 278q8-8 16 0m-13 5q5-5 10 0"
            stroke="#D9ED9E"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </g>
        <g className="landing-cleaner">
          <path
            d="M290 317 284 381M313 317 323 382"
            stroke="#153A39"
            strokeWidth="19"
            strokeLinecap="round"
          />
          <path d="M286 378h-12q-8 3-8 13h28v-9m23-4h12q11 2 13 13h-28v-9" fill="#0C292B" />
          <path d="M282 230q20-11 38 0l11 91q-28 12-57 0Z" fill="#D9ED9E" />
          <path d="m292 230 0 36h23v-36m-38 43h51" stroke="#ADC77C" strokeWidth="3" />
          <rect x="292" y="287" width="25" height="19" rx="3" fill="#B9D28A" />
          <g className="landing-tapping-arm">
            <path d="m284 243-25 29-29 7" stroke="#D9ED9E" strokeWidth="16" strokeLinecap="round" />
            <path d="m230 279-9 2" stroke="#DCAD87" strokeWidth="11" strokeLinecap="round" />
            <g className="landing-handset-art">
              <rect
                x="215"
                y="259"
                width="18"
                height="31"
                rx="4"
                fill="#10243D"
                transform="rotate(-12 224 275)"
              />
              <rect
                x="219"
                y="264"
                width="10"
                height="17"
                rx="2"
                fill="#E3EFDD"
                transform="rotate(-12 224 275)"
              />
            </g>
          </g>
          <path d="m319 243 25 39 14-4" stroke="#D9ED9E" strokeWidth="16" strokeLinecap="round" />
          <path d="m358 278 7-2" stroke="#DCAD87" strokeWidth="11" strokeLinecap="round" />
          <path d="M298 215v16" stroke="#DCAD87" strokeWidth="13" />
          <circle cx="300" cy="199" r="24" fill="#E8BC96" />
          <circle cx="321" cy="179" r="12" fill="#173B37" />
          <path d="M276 199q-6-35 24-33 26 0 25 32-17-3-27-15-5 11-22 16" fill="#173B37" />
          <circle cx="290" cy="201" r="2" fill="#173B37" />
          <circle cx="307" cy="201" r="2" fill="#173B37" />
          <path d="M291 212q7 6 14 0" stroke="#9B5C43" strokeWidth="2" strokeLinecap="round" />
          <path d="m363 248-13 140" stroke="#B6C9B6" strokeWidth="6" strokeLinecap="round" />
          <path d="m325 389 53 4-1 9-58-4Z" fill="#D1DEC5" />
          <path
            d="m329 397-1 5m10-4-1 5m10-4-1 5m10-4-1 5m10-4-1 5"
            stroke="#93B09A"
            strokeWidth="3"
          />
        </g>
        <g className="landing-tap-pulse">
          <circle cx="221" cy="283" r="25" stroke="#D9ED9E" strokeWidth="2" />
          <circle cx="221" cy="283" r="36" stroke="#D9ED9E" strokeOpacity=".5" />
        </g>
        <path
          className="landing-data-path"
          d="M239 277C381 113 355 151 411 151"
          stroke="#C7E5BA"
          strokeWidth="2"
          strokeDasharray="4 8"
        />
        <g className="landing-result">
          <rect x="409" y="111" width="169" height="235" rx="17" fill="#F6F5EF" />
          <rect x="425" y="130" width="64" height="6" rx="3" fill="#9FB6A5" />
          <circle cx="494" cy="184" r="28" fill="#DCEBCC" />
          <path
            className="landing-result-check"
            d="m482 184 9 9 17-20"
            stroke="#326449"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <rect x="441" y="230" width="105" height="8" rx="4" fill="#46655A" />
          <rect x="457" y="247" width="73" height="5" rx="2.5" fill="#B2C2AE" />
          <path
            d="M434 314V291m24 23v-35m24 35v-20m24 20v-42m24 42v-55m24 55v-36"
            stroke="#8AA98B"
            strokeWidth="12"
            strokeLinecap="round"
          />
        </g>
      </svg>
      <div className="landing-story-status" aria-hidden="true">
        <span className="landing-story-check">✓</span>
        <span>
          <strong>{t('visualStatus')}</strong>
          <small>{t('visualSubstatus')}</small>
        </span>
      </div>
    </div>
  )
}

export default function ProductPage() {
  const t = useTranslations('landing')
  const integrations = useTranslations('integrations')
  const locale = useLocale()
  const { setLocale } = useLocaleSetting()
  const [state, setState] = useState<TrialState>('idle')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    setState('sending')
    try {
      await apiFetch<{ ok: true }>('/public/trial-requests', {
        method: 'POST',
        body: {
          email: String(values.get('email') ?? '').trim(),
          company: String(values.get('company') ?? '').trim(),
          locale,
        },
      })
      form.reset()
      setState('success')
    } catch (cause) {
      if (cause instanceof ApiError && (cause.status === 400 || cause.status === 422))
        setState('invalid')
      else if (cause instanceof ApiError && cause.status === 429) setState('limited')
      else setState('error')
    }
  }

  return (
    <div className="landing">
      <a className="landing-skip" href="#landing-main">
        {t('skip')}
      </a>
      <header className="landing-header">
        <a href="#top" className="landing-logo" aria-label={t('brandHome')}>
          <span className="landing-logo-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>
            NFC <strong>TimeSheets</strong>
          </span>
        </a>
        <nav className="landing-nav" aria-label={t('navLabel')}>
          <a href="#how">{t('navHow')}</a>
          <a href="#benefits">{t('navBenefits')}</a>
          <a href="#pricing">{t('navPricing')}</a>
        </nav>
        <div className="landing-header-actions">
          <fieldset className="landing-language" aria-label={t('language')}>
            {(['de', 'en'] as const).map((language) => (
              <button
                key={language}
                type="button"
                aria-pressed={locale === language}
                onClick={() => setLocale(language)}
              >
                {language.toUpperCase()}
              </button>
            ))}
          </fieldset>
          <Link className="landing-login" href={LOGIN_PATH}>
            {t('login')}
          </Link>
          <a className="landing-button landing-button-primary landing-header-cta" href="#book-call">
            {t('bookCallShort')}
          </a>
        </div>
      </header>

      <main id="landing-main" tabIndex={-1}>
        <section className="landing-hero" id="top" aria-labelledby="landing-title">
          <div className="landing-hero-copy">
            <p className="landing-eyebrow">
              <span />
              {t('eyebrow')}
            </p>
            <h1 id="landing-title">{t('heroTitle')}</h1>
            <p className="landing-hero-lede">{t('heroLead')}</p>
            <div className="landing-hero-actions">
              <a href="#trial" className="landing-button landing-button-primary">
                {t('heroCta')} <span aria-hidden="true">↗</span>
              </a>
              <a href="#book-call" className="landing-button landing-button-dark">
                {t('bookCall')}
              </a>
              <a href="#how" className="landing-text-link">
                {t('heroSecondary')} <span aria-hidden="true">↓</span>
              </a>
            </div>
            <div className="landing-proof">
              <span className="landing-proof-icon" aria-hidden="true">
                ✓
              </span>
              {t('proof')}
            </div>
          </div>
          <TapStory />
        </section>

        <section className="landing-integrations" aria-labelledby="integrations-title">
          <div className="landing-integrations-heading">
            <div>
              <p className="landing-kicker">{integrations('eyebrow')}</p>
              <h2 id="integrations-title">{integrations('title')}</h2>
            </div>
            <p>{integrations('lead')}</p>
          </div>
          <div className="landing-integration-grid">
            {(['teams', 'microsoft365', 'outlook', 'google'] as const).map((provider) => (
              <article className="landing-integration" key={provider}>
                <Image
                  unoptimized
                  src={`/integrations/${provider}.svg`}
                  width="56"
                  height="56"
                  alt=""
                />
                <span className="landing-soon">{integrations('soon')}</span>
                <h3>{integrations(provider)}</h3>
                <p>{integrations(`${provider}Note`)}</p>
              </article>
            ))}
          </div>
          <div className="landing-microsoft">
            <MicrosoftPlaceholder />
          </div>
        </section>

        <section
          className="landing-process landing-section"
          id="how"
          aria-labelledby="landing-how-title"
        >
          <div className="landing-section-intro">
            <p className="landing-kicker">{t('howKicker')}</p>
            <h2 id="landing-how-title">{t('howTitle')}</h2>
            <p>{t('howLead')}</p>
          </div>
          <div className="landing-steps">
            <article className="landing-step">
              <span className="landing-step-number">01</span>
              <span className="landing-step-symbol" aria-hidden="true">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 21V5l8-3 8 3v16M2 21h20M9 21v-5h6v5M8 7h1m6 0h1M8 11h1m6 0h1" />
                </svg>
              </span>
              <h3>{t('step1Title')}</h3>
              <p>{t('step1Body')}</p>
            </article>
            <article className="landing-step">
              <span className="landing-step-number">02</span>
              <span className="landing-step-symbol" aria-hidden="true">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="8" y="3" width="10" height="18" rx="2" />
                  <path d="M12 17h2M3 7a8 8 0 0 1 0 10M5 10a4 4 0 0 1 0 4" />
                </svg>
              </span>
              <h3>{t('step2Title')}</h3>
              <p>{t('step2Body')}</p>
            </article>
            <article className="landing-step">
              <span className="landing-step-number">03</span>
              <span className="landing-step-symbol" aria-hidden="true">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="5" y="4" width="14" height="17" rx="2" />
                  <path d="M9 4V2h6v2M9 16v-3m3 3V9m3 7v-5" />
                </svg>
              </span>
              <h3>{t('step3Title')}</h3>
              <p>{t('step3Body')}</p>
            </article>
          </div>
        </section>

        <section
          className="landing-benefits landing-section"
          id="benefits"
          aria-labelledby="landing-benefits-title"
        >
          <div className="landing-benefits-copy">
            <p className="landing-kicker">{t('benefitsKicker')}</p>
            <h2 id="landing-benefits-title">{t('benefitsTitle')}</h2>
            <p>{t('benefitsLead')}</p>
            <ul className="landing-benefit-list">
              <li>
                <span aria-hidden="true">✓</span>
                {t('benefit1')}
              </li>
              <li>
                <span aria-hidden="true">✓</span>
                {t('benefit2')}
              </li>
              <li>
                <span aria-hidden="true">✓</span>
                {t('benefit3')}
              </li>
            </ul>
          </div>
          <div className="landing-dashboard" aria-label={t('dashboardA11y')} role="img">
            <div className="landing-dashboard-head">
              <span>{t('dashboardTitle')}</span>
              <small>{t('dashboardExample')}</small>
            </div>
            <div className="landing-dashboard-cards">
              <div>
                <small>{t('dashboardHours')}</small>
                <strong>
                  124,5 <em>h</em>
                </strong>
                <span>{t('dashboardMonth')}</span>
              </div>
              <div>
                <small>{t('dashboardPeople')}</small>
                <strong>8</strong>
                <span>{t('dashboardActive')}</span>
              </div>
            </div>
            <div className="landing-chart" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className="landing-dashboard-foot">
              <span className="landing-green-dot" />
              {t('dashboardFoot')}
            </div>
          </div>
        </section>

        <section className="landing-day landing-section" aria-labelledby="landing-day-title">
          <div className="landing-day-heading">
            <p className="landing-kicker">{t('dayKicker')}</p>
            <h2 id="landing-day-title">{t('dayTitle')}</h2>
            <p>{t('dayLead')}</p>
          </div>
          <ol className="landing-timeline">
            {(['plan', 'work', 'review'] as const).map((step, index) => (
              <li key={step}>
                <span className="landing-timeline-number" aria-hidden="true">
                  0{index + 1}
                </span>
                <div>
                  <p className="landing-kicker">{t(`day.${step}.when`)}</p>
                  <h3>{t(`day.${step}.title`)}</h3>
                  <p>{t(`day.${step}.body`)}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section
          className="landing-questions landing-section"
          aria-labelledby="landing-questions-title"
        >
          <div>
            <p className="landing-kicker">{t('questionsKicker')}</p>
            <h2 id="landing-questions-title">{t('questionsTitle')}</h2>
          </div>
          <div>
            {(['phone', 'pay', 'setup'] as const).map((question) => (
              <details key={question}>
                <summary>{t(`questions.${question}.title`)}</summary>
                <p>{t(`questions.${question}.body`)}</p>
              </details>
            ))}
          </div>
        </section>

        <section
          className="landing-pricing landing-section"
          id="pricing"
          aria-labelledby="landing-pricing-title"
        >
          <div className="landing-section-intro">
            <p className="landing-kicker">{t('pricingKicker')}</p>
            <h2 id="landing-pricing-title">{t('pricingTitle')}</h2>
            <p>{t('pricingLead')}</p>
          </div>
          <div className="landing-price-card">
            <div className="landing-price-main">
              <span className="landing-price-label">{t('pricingPlan')}</span>
              <p>
                <strong>€300</strong>
                <span>{t('pricingPeriod')}</span>
              </p>
            </div>
            <div className="landing-price-details">
              <span className="landing-free-badge">{t('pricingFree')}</span>
              <ul>
                <li>{t('pricingUsers')}</li>
                <li>{t('pricingIncluded')}</li>
                <li>{t('pricingExtra')}</li>
              </ul>
              <a className="landing-button landing-button-primary" href="#trial">
                {t('pricingCta')} <span aria-hidden="true">↗</span>
              </a>
            </div>
          </div>
        </section>

        <section
          className="landing-trial landing-section"
          id="trial"
          aria-labelledby="landing-trial-title"
        >
          <div>
            <p className="landing-kicker">{t('trialKicker')}</p>
            <h2 id="landing-trial-title">{t('trialTitle')}</h2>
            <p>{t('trialLead')}</p>
          </div>
          <form className="landing-trial-form" onSubmit={submit}>
            <div className="landing-form-grid">
              <label htmlFor="trial-company">
                {t('companyLabel')}
                <input
                  id="trial-company"
                  name="company"
                  required
                  maxLength={200}
                  autoComplete="organization"
                  placeholder={t('companyPlaceholder')}
                  disabled={state === 'sending'}
                />
              </label>
              <label htmlFor="trial-email">
                {t('emailLabel')}
                <input
                  id="trial-email"
                  name="email"
                  type="email"
                  required
                  maxLength={320}
                  autoComplete="email"
                  placeholder={t('emailPlaceholder')}
                  disabled={state === 'sending'}
                />
              </label>
            </div>
            <button
              className="landing-button landing-button-dark"
              type="submit"
              disabled={state === 'sending'}
            >
              {state === 'sending' ? t('sending') : t('submit')} <span aria-hidden="true">↗</span>
            </button>
            <p className="landing-form-note">{t('formNote')}</p>
            {state === 'success' && (
              <p className="landing-form-message landing-form-success" role="status">
                {t('success')}
              </p>
            )}
            {state === 'invalid' && (
              <p className="landing-form-message landing-form-error" role="alert">
                {t('invalid')}
              </p>
            )}
            {state === 'limited' && (
              <p className="landing-form-message landing-form-error" role="alert">
                {t('limited')}
              </p>
            )}
            {state === 'error' && (
              <p className="landing-form-message landing-form-error" role="alert">
                {t('error')}
              </p>
            )}
          </form>
        </section>
        <section className="landing-section" id="book-call" aria-labelledby="book-call-title">
          <h2 id="book-call-title">{t('bookCall')}</h2>
          <p>{t('bookingUnavailable')}</p>
        </section>
      </main>
      <footer className="landing-footer">
        <span>
          NFC <strong>TimeSheets</strong>
        </span>
        <span>{t('footer')}</span>
        <a href="#top">{t('backTop')} ↑</a>
      </footer>
    </div>
  )
}
