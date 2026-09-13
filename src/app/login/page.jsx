import { Suspense } from 'react'
import LoginForm from './LoginForm.jsx'

export const metadata = { title: 'Log in — World of Wonders' }

export default function LoginPage() {
  return (
    <div className="login-screen">
      {/* useSearchParams (for `?next=`) requires a Suspense boundary in the App Router. */}
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  )
}
