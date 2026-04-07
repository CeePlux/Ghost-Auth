/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { 
  Smartphone, 
  Activity, 
  Terminal, 
  Shield, 
  RefreshCw, 
  AlertCircle, 
  CheckCircle2, 
  Clock,
  Search,
  Settings,
  LogOut,
  Play,
  Trash2,
  ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  collection, 
  onSnapshot, 
  query, 
  orderBy, 
  limit, 
  addDoc, 
  serverTimestamp,
  doc,
  updateDoc,
  deleteDoc
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User
} from 'firebase/auth';
import { db, auth } from './firebase';
import { cn } from './lib/utils';

// --- Types ---
interface PhoneNumber {
  id: string;
  number: string;
  country: string;
  source: string;
  addedAt: any;
  status: 'found' | 'requesting_otp' | 'otp_found' | 'active_ghost' | 'skipped_exists' | 'activation_failed' | 'new' | 'processing' | 'success' | 'failed' | 'banned';
  otp?: string;
  survivalState?: string;
  aboutStatus?: string;
  lastSurvivalRun?: any;
}

interface SystemLog {
  id: string;
  timestamp: any;
  level: 'info' | 'warn' | 'error';
  message: string;
  deviceId?: string;
}

// --- Components ---

const StatusBadge = ({ status }: { status: string }) => {
  const colors = {
    online: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
    offline: 'bg-slate-500/10 text-slate-500 border-slate-500/20',
    busy: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
    error: 'bg-rose-500/10 text-rose-500 border-rose-500/20',
    new: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    processing: 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20',
    success: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
    failed: 'bg-rose-500/10 text-rose-500 border-rose-500/20',
    banned: 'bg-slate-800/50 text-slate-400 border-slate-700',
    found: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    requesting_otp: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
    otp_found: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
    active_ghost: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
    skipped_exists: 'bg-slate-500/10 text-slate-500 border-slate-500/20',
    activation_failed: 'bg-rose-500/10 text-rose-500 border-rose-500/20',
  };

  return (
    <span className={cn(
      "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border",
      colors[status as keyof typeof colors] || colors.offline
    )}>
      {status}
    </span>
  );
};

const API_BASE = ''; // Use relative paths to avoid CORS/URL issues in AI Studio

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [activeTab, setActiveTab] = useState<'numbers' | 'sniffer' | 'logs'>('numbers');
  const [snifferActive, setSnifferActive] = useState(false);
  const [manualHunting, setManualHunting] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const toggleSniffer = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/sniffer/toggle`, { method: 'POST' });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const data = await res.json();
      setSnifferActive(data.active);
    } catch (e: any) {
      console.error("Failed to toggle sniffer:", e);
      alert("Failed to toggle scavenger: " + e.message);
    }
  };

  const triggerManualHunt = async () => {
    setManualHunting(true);
    try {
      const res = await fetch(`${API_BASE}/api/sniffer/trigger`, { method: 'POST' });
      const data = await res.json();
      alert(data.message);
    } catch (err: any) {
      alert("Hunt failed: " + err.message);
    } finally {
      setManualHunting(false);
    }
  };

  const [waStatus, setWaStatus] = useState<string>('Automated Farm Active');

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/whatsapp/status`);
        const data = await res.json();
        setWaStatus(data.status);

        const snifferRes = await fetch(`${API_BASE}/api/sniffer/status`);
        const snifferData = await snifferRes.json();
        setSnifferActive(snifferData.active);
      } catch (e) {}
    };
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!user) return;

    const unsubNumbers = onSnapshot(
      query(collection(db, 'numbers'), orderBy('addedAt', 'desc'), limit(50)),
      (snapshot) => {
        setNumbers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PhoneNumber)));
      }
    );

    const unsubLogs = onSnapshot(
      query(collection(db, 'logs'), orderBy('timestamp', 'desc'), limit(100)),
      (snapshot) => {
        setLogs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SystemLog)));
      }
    );

    return () => {
      unsubNumbers();
      unsubLogs();
    };
  }, [user]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (err) {
      console.error("Login failed", err);
    }
  };

  const handleLogout = () => signOut(auth);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0c] flex items-center justify-center">
        <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0a0a0c] flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-[#111114] border border-white/5 p-8 rounded-2xl shadow-2xl text-center"
        >
          <div className="w-16 h-16 bg-indigo-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Shield className="w-8 h-8 text-indigo-500" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2 tracking-tight">Ghost-Auth Device Farm</h1>
          <p className="text-slate-400 mb-8 text-sm leading-relaxed">
            Private administrative dashboard for automated WhatsApp registration and remote Android management.
          </p>
          <button 
            onClick={handleLogin}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 rounded-xl transition-all flex items-center justify-center gap-2"
          >
            <Shield className="w-5 h-5" />
            Sign in with Google
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-slate-300 font-sans selection:bg-indigo-500/30">
      {/* --- Sidebar --- */}
      <aside className="fixed left-0 top-0 bottom-0 w-20 md:w-64 bg-[#111114] border-r border-white/5 z-50 flex flex-col">
        <div className="p-6 flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center shrink-0">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-white tracking-tight hidden md:block">GHOST-AUTH</span>
        </div>

        <nav className="flex-1 px-4 space-y-2 mt-4">
          <button 
            onClick={() => setActiveTab('numbers')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all group",
              activeTab === 'numbers' ? "bg-indigo-500/10 text-indigo-400" : "hover:bg-white/5"
            )}
          >
            <Smartphone className={cn("w-5 h-5", activeTab === 'numbers' ? "text-indigo-400" : "text-slate-500 group-hover:text-slate-300")} />
            <span className="font-medium hidden md:block">Active Ghosts</span>
          </button>
          <button 
            onClick={() => setActiveTab('sniffer')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all group",
              activeTab === 'sniffer' ? "bg-indigo-500/10 text-indigo-400" : "hover:bg-white/5"
            )}
          >
            <Search className={cn("w-5 h-5", activeTab === 'sniffer' ? "text-indigo-400" : "text-slate-500 group-hover:text-slate-300")} />
            <span className="font-medium hidden md:block">Scavenger Farm</span>
          </button>
          <button 
            onClick={() => setActiveTab('logs')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all group",
              activeTab === 'logs' ? "bg-indigo-500/10 text-indigo-400" : "hover:bg-white/5"
            )}
          >
            <Terminal className={cn("w-5 h-5", activeTab === 'logs' ? "text-indigo-400" : "text-slate-500 group-hover:text-slate-300")} />
            <span className="font-medium hidden md:block">System Logs</span>
          </button>
        </nav>

        <div className="p-4 border-t border-white/5">
          <div className="flex items-center gap-3 px-4 py-3">
            <img src={user.photoURL || ''} className="w-8 h-8 rounded-full border border-white/10" referrerPolicy="no-referrer" />
            <div className="hidden md:block overflow-hidden">
              <p className="text-xs font-bold text-white truncate">{user.displayName}</p>
              <p className="text-[10px] text-slate-500 truncate">{user.email}</p>
            </div>
          </div>
          <button 
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-rose-500/10 hover:text-rose-400 transition-all text-slate-500 mt-2"
          >
            <LogOut className="w-5 h-5" />
            <span className="font-medium hidden md:block">Logout</span>
          </button>
        </div>
      </aside>

      {/* --- Main Content --- */}
      <main className="ml-20 md:ml-64 p-4 md:p-8">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h2 className="text-2xl font-bold text-white tracking-tight">
              {activeTab === 'numbers' && "Active Ghosts"}
              {activeTab === 'sniffer' && "Scavenger Farm Engine"}
              {activeTab === 'logs' && "System Activity Logs"}
            </h2>
            <p className="text-sm text-slate-500">
              {activeTab === 'numbers' && `${numbers.filter(n => n.status === 'active_ghost').length} active ghosts in the farm.`}
              {activeTab === 'sniffer' && "Automated hunting for free numbers on public SMS sites."}
              {activeTab === 'logs' && "Real-time audit trail of automation and scraping events."}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="bg-[#111114] border border-white/5 rounded-xl px-4 py-2 flex items-center gap-2">
              <div className={cn(
                "w-2 h-2 rounded-full animate-pulse",
                snifferActive ? "bg-indigo-500" : "bg-slate-500"
              )} />
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">SNIFFER: {snifferActive ? 'ACTIVE' : 'IDLE'}</span>
            </div>
            <div className="bg-[#111114] border border-white/5 rounded-xl px-4 py-2 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">{waStatus}</span>
            </div>
          </div>
        </header>

        <AnimatePresence mode="wait">
          {activeTab === 'numbers' && (
            <motion.div 
              key="numbers"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              {/* Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'Scanned', value: numbers.length, icon: Search, color: 'text-blue-500' },
                  { label: 'Active Ghosts', value: numbers.filter(n => n.status === 'active_ghost').length, icon: Shield, color: 'text-emerald-500' },
                  { label: 'OTPs Found', value: numbers.filter(n => n.otp).length, icon: Activity, color: 'text-indigo-500' },
                  { label: 'Failed', value: numbers.filter(n => n.status === 'activation_failed').length, icon: AlertCircle, color: 'text-rose-500' },
                ].map((stat, i) => (
                  <div key={i} className="bg-[#111114] border border-white/5 p-4 rounded-2xl">
                    <div className="flex items-center gap-3 mb-2">
                      <stat.icon className={cn("w-4 h-4", stat.color)} />
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{stat.label}</span>
                    </div>
                    <p className="text-2xl font-bold text-white">{stat.value}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {numbers.map((num) => (
                  <motion.div 
                    key={num.id}
                    className="bg-[#111114] border border-white/5 p-6 rounded-2xl hover:border-indigo-500/30 transition-all group relative overflow-hidden"
                  >
                    {num.status === 'active_ghost' && (
                      <div className="absolute top-0 right-0 p-2">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                      </div>
                    )}
                    
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-10 h-10 rounded-xl flex items-center justify-center",
                          num.status === 'active_ghost' ? "bg-emerald-500/10" : "bg-amber-500/10"
                        )}>
                          <Smartphone className={cn(
                            "w-5 h-5",
                            num.status === 'active_ghost' ? "text-emerald-500" : "text-amber-500"
                          )} />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-white">+{num.number}</p>
                          <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">{num.source}</p>
                        </div>
                      </div>
                      <StatusBadge status={num.status} />
                    </div>

                    {num.status === 'active_ghost' && (
                      <div className="mb-4 space-y-2 bg-white/5 p-3 rounded-xl border border-white/5">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-slate-500 uppercase font-bold">Survival State</span>
                          <span className="text-[10px] text-emerald-400 font-bold">{num.survivalState || 'Active'}</span>
                        </div>
                        {num.aboutStatus && (
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-slate-500 uppercase font-bold">About</span>
                            <span className="text-[10px] text-slate-300 italic truncate max-w-[120px]">"{num.aboutStatus}"</span>
                          </div>
                        )}
                      </div>
                    )}
                    
                    <div className="flex items-center justify-between pt-4 border-t border-white/5">
                      <div className="flex items-center gap-2">
                        <Clock className="w-3 h-3 text-slate-600" />
                        <span className="text-[10px] text-slate-500">
                          {num.addedAt?.toDate().toLocaleTimeString()}
                        </span>
                      </div>
                      {num.otp && (
                        <div className="flex items-center gap-1.5">
                          <Shield className="w-3 h-3 text-indigo-500" />
                          <span className="text-[10px] font-mono text-indigo-400">{num.otp}</span>
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))}
                {numbers.length === 0 && (
                  <div className="col-span-full py-20 text-center border-2 border-dashed border-white/5 rounded-3xl">
                    <Smartphone className="w-12 h-12 text-slate-800 mx-auto mb-4" />
                    <h3 className="text-lg font-bold text-slate-500">No Ghosts Found</h3>
                    <p className="text-sm text-slate-600">The scavenger farm is currently hunting for new numbers.</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {activeTab === 'sniffer' && (
            <motion.div 
              key="sniffer"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between bg-[#111114] border border-white/5 p-6 rounded-2xl">
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "w-12 h-12 rounded-xl flex items-center justify-center transition-colors",
                    snifferActive ? "bg-indigo-500/10 text-indigo-400" : "bg-slate-500/10 text-slate-500"
                  )}>
                    <Activity className={cn("w-6 h-6", snifferActive && "animate-pulse")} />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white tracking-tight">Scavenger Farm Engine</h3>
                    <p className="text-xs text-slate-500">
                      {snifferActive ? "Engine is currently hunting for free numbers on public SMS sites." : "Engine is currently idle."}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button 
                    onClick={triggerManualHunt}
                    disabled={manualHunting}
                    className={cn(
                      "px-6 py-3 rounded-xl font-bold transition-all flex items-center gap-2",
                      manualHunting 
                        ? "bg-indigo-500/10 text-indigo-400 cursor-not-allowed" 
                        : "bg-white/5 text-white hover:bg-white/10 border border-white/10"
                    )}
                  >
                    {manualHunting ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Hunting...
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4" />
                        🚀 Start Manual Hunt
                      </>
                    )}
                  </button>
                  <button 
                    onClick={toggleSniffer}
                    className={cn(
                      "px-6 py-3 rounded-xl font-bold transition-all flex items-center gap-2",
                      snifferActive 
                        ? "bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 border border-rose-500/20" 
                        : "bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-500/20"
                    )}
                  >
                    {snifferActive ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Stop Scavenger
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4" />
                        Start Scavenger
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-[#111114] border border-white/5 p-6 rounded-2xl">
                  <h3 className="text-sm font-bold text-white mb-4 uppercase tracking-widest">Target Sources</h3>
                  <div className="space-y-3">
                    {['receive-smss.com', 'receive-sms-free.cc', 'mobilesms.io'].map(site => (
                      <div key={site} className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
                        <span className="text-xs text-slate-300 font-medium">{site}</span>
                        <div className="w-2 h-2 rounded-full bg-emerald-500" />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-[#111114] border border-white/5 p-6 rounded-2xl">
                  <h3 className="text-sm font-bold text-white mb-4 uppercase tracking-widest">Engine Config</h3>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-500">Cycle Interval</span>
                      <span className="text-xs text-white font-bold">10 Minutes</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-500">Safety Delay</span>
                      <span className="text-xs text-white font-bold">15m / 5 Checks</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-500">Survival Layer</span>
                      <span className="text-xs text-emerald-500 font-bold">ACTIVE</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Heartbeat Debug Section */}
              <div className="bg-[#111114] border border-white/5 p-6 rounded-2xl">
                <div className="flex items-center gap-2 mb-4">
                  <RefreshCw className="w-4 h-4 text-indigo-500" />
                  <h3 className="text-sm font-bold text-white uppercase tracking-widest">Scraper Heartbeat (receive-smss.com)</h3>
                </div>
                <div className="bg-black/50 p-4 rounded-xl border border-white/5 font-mono text-[10px] text-slate-400 overflow-x-auto">
                  {logs.find(l => l.message.includes('Heartbeat Check'))?.message.split('): ')[1] || 'Waiting for next heartbeat cycle...'}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'logs' && (
            <motion.div 
              key="logs"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="bg-[#050505] border border-white/5 rounded-2xl p-6 font-mono text-xs leading-relaxed overflow-hidden flex flex-col h-[600px]"
            >
              <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-4">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-indigo-500" />
                  <span className="font-bold text-slate-400 uppercase tracking-widest">System Audit Trail</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-[10px] text-slate-600">AUTO-SCROLL: ON</span>
                  <button 
                    onClick={async () => {
                      for (const log of logs) {
                        await deleteDoc(doc(db, 'logs', log.id));
                      }
                    }}
                    className="text-slate-500 hover:text-rose-500 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto space-y-1 custom-scrollbar pr-2">
                {logs.map((log) => (
                  <div key={log.id} className="flex gap-4 group">
                    <span className="text-slate-700 shrink-0">
                      [{log.timestamp?.toDate().toLocaleTimeString()}]
                    </span>
                    <span className={cn(
                      "font-bold shrink-0 w-12",
                      log.level === 'error' ? "text-rose-500" : 
                      log.level === 'warn' ? "text-amber-500" : "text-indigo-500"
                    )}>
                      {log.level.toUpperCase()}
                    </span>
                    <span className={cn(
                      "flex-1",
                      log.level === 'error' ? "text-rose-400/80" : "text-slate-400"
                    )}>
                      {log.message}
                    </span>
                    {log.deviceId && (
                      <span className="text-slate-600 italic group-hover:text-slate-400 transition-colors">
                        @{log.deviceId}
                      </span>
                    )}
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* --- Global Styles --- */}
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.1);
        }
      `}</style>
    </div>
  );
}
