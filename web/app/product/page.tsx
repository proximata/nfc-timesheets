'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/** The landing page used to live here. Old links (and `#anchors`) land on `/` instead. */
export default function ProductRedirectPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace(`/${window.location.hash}`)
  }, [router])
  return null
}
