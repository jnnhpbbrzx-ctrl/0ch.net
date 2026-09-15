import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Activity, Bell, Braces, ChevronDown, CircleUserRound, Headphones, HelpCircle, Mic, MicOff, MonitorUp, Phone, Play, Radio, Search, Send, Settings, SlidersHorizontal, Sparkles, Volume2, VolumeX, Wifi, X } from 'lucide-react'

type Tab = 'welcome' | 'general' | 'voice' | 'settings' | 'animations'
type Tone = 'join' | 'leave' | 'mute' | 'unmute' | 'deafen' | 'undeafen' | 'message' | 'ring'

const members = [
  { name: 'Mira Chen', handle: '@miracode', color: '#d19a66', status: 'Writing TypeScript' },
  { name: 'Alex Novak', handle: '@anovak', color: '#61afef', status: 'Listening in room' },
  { name: 'You', handle: '@operator', color: '#98c379', status: 'Online' },
]

function playTone(type: Tone, volume = 0.55) {
  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextClass) return
  const context = new AudioContextClass()
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  const settings: Record<Tone, [number, number, number]> = { join: [520, 740, .12], leave: [740, 420, .14], mute: [320, 220, .1], unmute: [260, 380, .1], deafen: [430, 180, .16], undeafen: [180, 430, .16], message: [680, 680, .06], ring: [540, 820, .3] }
  const [start, end, duration] = settings[type]
  oscillator.type = type === 'ring' ? 'sine' : 'triangle'
  oscillator.frequency.setValueAtTime(start, context.currentTime)
  oscillator.frequency.exponentialRampToValueAtTime(end, context.currentTime + duration)
  gain.gain.setValueAtTime(0.0001, context.currentTime)
  gain.gain.exponentialRampToValueAtTime(Math.max(volume, .01) * .08, context.currentTime + .01)
  gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + duration)
  oscillator.connect(gain).connect(context.destination)
  oscillator.start()
  oscillator.stop(context.currentTime + duration + .02)
}

function Avatar({ member, active = false }: { member: typeof members[number], active?: boolean }) {
  return <div className={`avatar ${active ? 'avatar-active' : ''}`} style={{ '--avatar': member.color } as React.CSSProperties}>{member.name.slice(0, 1)}</div>
}

function App() {
  const [tab, setTab] = useState<Tab>('welcome')
  const [micMuted, setMicMuted] = useState(false)
  const [deafened, setDeafened] = useState(false)
  const [joined, setJoined] = useState(true)
  const [query, setQuery] = useState('')
  const [volume, setVolume] = useState(() => Number(localStorage.getItem('system-volume') ?? 70))
  const [profileName, setProfileName] = useState(() => localStorage.getItem('profile-name') ?? 'You')
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => { localStorage.setItem('system-volume', String(volume)) }, [volume])
  useEffect(() => { localStorage.setItem('profile-name', profileName) }, [profileName])
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    let frame = 0
    const render = () => {
      const { width, height } = canvas.getBoundingClientRect()
      const ratio = window.devicePixelRatio || 1
      canvas.width = width * ratio; canvas.height = height * ratio; context.scale(ratio, ratio)
      context.fillStyle = '#171717'; context.fillRect(0, 0, width, height)
      for (let index = 0; index < 48; index += 1) {
        const bar = 10 + Math.abs(Math.sin(frame * .035 + index * .42)) * (height * .48)
        const x = index * (width / 48) + 4
        context.fillStyle = index % 4 === 0 ? '#61afef' : '#98c379'
        context.globalAlpha = .35 + (index % 5) * .1
        context.fillRect(x, height / 2 - bar / 2, 3, bar)
      }
      context.globalAlpha = 1
      frame += 1
      requestAnimationFrame(render)
    }
    render()
  }, [])

  const actionTone = (tone: Tone) => playTone(tone, volume / 100)
  const setTabWithTone = (next: Tab) => { setTab(next); actionTone('message') }

  return <div className="app-shell">
    <aside className="activity-bar">
      <div className="brand-mark">0<span>ch</span></div>
      <nav className="activity-nav">
        <button className={tab === 'welcome' || tab === 'general' ? 'activity-button active' : 'activity-button'} onClick={() => setTabWithTone('general')} title="Chats"><Braces /></button>
        <button className={tab === 'voice' ? 'activity-button active' : 'activity-button'} onClick={() => setTabWithTone('voice')} title="Calls"><Phone /></button>
        <button className="activity-button" onClick={() => setTabWithTone('animations')} title="Animations"><Activity /></button>
        <button className="activity-button" onClick={() => setTabWithTone('settings')} title="Profile"><CircleUserRound /></button>
      </nav>
      <div className="activity-bottom"><button className="activity-button" title="Help"><HelpCircle /></button><button className="activity-button" onClick={() => setTabWithTone('settings')} title="Settings"><Settings /></button></div>
    </aside>

    <aside className="sidebar">
      <div className="workspace-title"><div><span className="eyebrow">WORKSPACE</span><strong>0ch.net / main</strong></div><ChevronDown size={14} /></div>
      <div className="search-box"><Search size={14} /><input aria-label="Search" placeholder="Search channels" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      <section className="sidebar-section"><div className="section-label"><span>TEXT CHANNELS</span><span>+</span></div><button className={`channel-row ${tab === 'general' ? 'selected' : ''}`} onClick={() => setTabWithTone('general')}><span className="hash">#</span> general <span className="unread">3</span></button><button className="channel-row"><span className="hash">#</span> release-notes</button></section>
      <section className="sidebar-section"><div className="section-label"><span>VOICE CHANNELS</span><span>+</span></div><button className={`channel-row ${tab === 'voice' ? 'selected' : ''}`} onClick={() => setTabWithTone('voice')}><Volume2 size={14} /> lounge <span className="voice-live">LIVE</span></button><div className="voice-members">{members.slice(0, 2).map((member) => <div className="mini-member" key={member.handle}><Avatar member={member} active /><span>{member.name}</span><Mic size={12} /></div>)}</div></section>
      <section className="sidebar-section dm-section"><div className="section-label"><span>DIRECT MESSAGES</span><span>+</span></div>{members.map((member) => <button className="dm-row" key={member.handle}><Avatar member={member} /><span><strong>{member.name}</strong><small>{member.handle}</small></span><span className="presence" /></button>)}</section>
      <div className="profile-card"><Avatar member={{ ...members[2], name: profileName }} /><div className="profile-copy"><strong>{profileName}</strong><span>online / 0ch-ops</span></div><button onClick={() => setTabWithTone('settings')} title="Profile settings"><SlidersHorizontal size={15} /></button></div>
    </aside>

    <main className="main-area">
      <header className="editor-tabs"><div className={`editor-tab ${tab === 'general' || tab === 'welcome' ? 'current' : ''}`} onClick={() => setTabWithTone('general')}><span className="tab-icon blue">#</span>general <X size={13} /></div>{tab === 'voice' && <div className="editor-tab current"><Phone size={14} /> lounge <X size={13} /></div>}{tab === 'settings' && <div className="editor-tab current"><Settings size={14} /> settings <X size={13} /></div>}{tab === 'animations' && <div className="editor-tab current"><Activity size={14} /> visualizer <X size={13} /></div>}<div className="tab-spacer" /><span className="connection-label"><span className="online-dot" /> websocket connected</span></header>
      <div className="content-wrap"><AnimatePresence mode="wait"><motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: .18 }} className="view">
        {(tab === 'welcome' || tab === 'general') && <><div className="breadcrumbs"><span>0ch.net</span><span>/</span><span>general</span><span>/</span><span>today</span></div><div className="chat-header"><div><span className="chat-title"><span className="hash">#</span> general</span><p>Team coordination and release chatter.</p></div><div className="header-actions"><button title="Notifications"><Bell size={16} /></button><button title="Search"><Search size={16} /></button><button title="Members"><CircleUserRound size={16} /></button></div></div><div className="messages"><div className="welcome-divider"><span>Today, September 15</span></div>{[['Mira Chen','10:42','Deploy window is green. I pushed the WebRTC signaling notes to release-notes.','d19a66'],['Alex Novak','10:47','The lounge room is open. Audio levels look clean on my side.','61afef'],['You','10:49','Acknowledged. I am checking the new notification mix now.','98c379']].map(([name, time, text, color]) => <div className="message" key={time}><div className="avatar" style={{ '--avatar': `#${color}` } as React.CSSProperties}>{name.slice(0, 1)}</div><div><div className="message-meta"><strong>{name}</strong><time>{time}</time></div><p>{text}</p></div></div>)}</div><div className="composer"><button title="Add attachment">+</button><input placeholder="Message #general" /><button title="Send message" onClick={() => actionTone('message')}><Send size={16} /></button></div></>}
        {tab === 'voice' && <div className="voice-view"><div className="voice-heading"><div><span className="eyebrow">VOICE CHANNEL</span><h1><Radio size={25} /> lounge</h1><p>Low-latency group audio / 3 participants</p></div><span className="secure-badge"><Wifi size={13} /> relay stable</span></div><div className="speaker-grid">{members.map((member, index) => <div className={`speaker ${index === 0 ? 'speaking' : ''}`} key={member.handle}><Avatar member={member} active={index === 0} /><strong>{member.name}</strong><span>{index === 0 ? 'speaking' : member.status}</span><div className="speaker-meter"><i style={{ width: `${index === 0 ? 72 : 34 + index * 12}%` }} /></div></div>)}</div><div className="call-controls"><button className={micMuted ? 'control-button danger' : 'control-button'} onClick={() => { setMicMuted(!micMuted); actionTone(micMuted ? 'unmute' : 'mute') }} title="Mute microphone">{micMuted ? <MicOff /> : <Mic />}<span>{micMuted ? 'Unmute microphone' : 'Mute microphone'}</span></button><button className={deafened ? 'control-button danger' : 'control-button'} onClick={() => { setDeafened(!deafened); actionTone(deafened ? 'undeafen' : 'deafen') }} title="Deafen audio">{deafened ? <VolumeX /> : <Headphones />}<span>{deafened ? 'Undeafen audio' : 'Deafen audio'}</span></button><button className="control-button" title="Screen share"><MonitorUp /><span>Screen share</span></button><button className="control-button leave" onClick={() => { setJoined(false); actionTone('leave') }} title="Leave call"><Phone /><span>Leave call</span></button></div>{!joined && <div className="join-banner"><span>Disconnected from lounge.</span><button onClick={() => { setJoined(true); actionTone('join') }}>Rejoin voice channel</button></div>}<div className="volume-panel"><div className="panel-title"><span>INDIVIDUAL VOLUME</span><span>3 ACTIVE USERS</span></div>{members.map((member, index) => <label className="volume-row" key={member.handle}><span><Avatar member={member} /><b>{member.name}</b></span><input type="range" min="0" max="100" defaultValue={index === 0 ? 82 : 68} /><span className="volume-value">{index === 0 ? '82' : '68'}%</span></label>)}</div></div>}
        {tab === 'animations' && <div className="visualizer-view"><div className="view-heading"><div><span className="eyebrow">EXPERIMENTAL SURFACE</span><h1>Audio visualizer</h1><p>Live canvas response from the system audio bus.</p></div><button className="primary-button" onClick={() => actionTone('ring')}><Play size={14} /> Test signal</button></div><canvas className="visualizer-canvas" ref={canvasRef} /><div className="code-readout"><span>source</span><strong>system.audio.output</strong><span>sample rate</span><strong>48,000 Hz</strong><span>latency</span><strong>18 ms</strong></div></div>}
        {tab === 'settings' && <div className="settings-view"><div className="view-heading"><div><span className="eyebrow">CONFIGURATION</span><h1>Settings</h1><p>Local preferences are persisted in your browser.</p></div></div><div className="settings-grid"><section className="settings-section"><h2>Profile</h2><label>Display name<input value={profileName} onChange={(event) => setProfileName(event.target.value)} /></label><label>Custom status<input defaultValue="Building calmly." /></label></section><section className="settings-section"><h2>Sound system</h2><label>System notification volume<div className="range-line"><input type="range" min="0" max="100" value={volume} onChange={(event) => setVolume(Number(event.target.value))} /><span>{volume}%</span></div></label><div className="sound-test"><span><Volume2 size={15} /> Preview event sounds</span><button onClick={() => actionTone('message')}><Play size={13} /> Play</button></div><p className="setting-note">Sounds are synthesized locally with Web Audio API. No audio files or external services are required.</p></section></div></div>}
      </motion.div></AnimatePresence></div>
      <footer className="status-bar"><span><span className="status-green" /> Online</span><span>main*</span><span>UTF-8</span><span>Spaces: 2</span><span className="status-grow" /><button onClick={() => { setMicMuted(!micMuted); actionTone(micMuted ? 'unmute' : 'mute') }} title="Microphone">{micMuted ? <MicOff size={13} /> : <Mic size={13} />}</button><button onClick={() => { setDeafened(!deafened); actionTone(deafened ? 'undeafen' : 'deafen') }} title="Audio">{deafened ? <VolumeX size={13} /> : <Volume2 size={13} />}</button><span className="railway"><Sparkles size={12} /> Hosted &amp; Powered by Railway</span></footer>
    </main>
  </div>
}

export default App
