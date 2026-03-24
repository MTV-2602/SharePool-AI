import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import PublicStorefront from './PublicStorefront.jsx'

const pathname = typeof window !== 'undefined' ? window.location.pathname.toLowerCase() : '/'
const RootComponent = pathname.startsWith('/store') ? PublicStorefront : App

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RootComponent />
  </StrictMode>,
)
