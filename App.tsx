import React, { useState, useEffect, useRef } from 'react';
import { CoordinatorDashboard } from './components/CoordinatorDashboard';
import { PatientInterface } from './components/PatientInterface';
import { ConclusionPatientView } from './components/ConclusionPatientView';
import { View, PatientData, CoordinatorProfile, AuthUser } from './types';
import { Button, Logo, Input, Card, Toast } from './components/UI';
import { auth } from './services/firebase';
import { 
  onAuthStateChanged, 
  signOut,
  GoogleAuthProvider,
  signInWithPopup
} from 'firebase/auth';
import { DataService } from './services/dataService';

// Decodificador seguro para leer el Base64 generado en CoordinatorDashboard (con soporte UTF-8)
const safeAtob = (str: string) => {
  try {
      // Los navegadores a veces convierten '+' en ' ' al leer URLSearchParams
      const normalizedStr = str.replace(/ /g, '+');
      return decodeURIComponent(atob(normalizedStr).split('').map(function(c) {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
  } catch (e) {
      console.error("Error decodificando safeAtob", e);
      // Fallback para enlaces antiguos
      return atob(str.replace(/ /g, '+'));
  }
};

const App: React.FC = () => {
  const [view, setView] = useState<View>(() => {
    const hash = window.location.hash;
    if (hash.startsWith('#/session')) return 'PATIENT_SESSION';
    if (hash.startsWith('#/conclusion')) return 'CONCLUSION_VIEW';
    return 'LANDING';
  });
  const [patientData, setPatientData] = useState<Partial<PatientData>>({});
  const [coordinator, setCoordinator] = useState<CoordinatorProfile | null>(null);
  const [isEditorMode, setIsEditorMode] = useState(false);
  const [conclusionPatientId, setConclusionPatientId] = useState<string | null>(null);
  const accessCodeInputNameRef = useRef(`ce-manual-${Math.random().toString(36).slice(2)}`);

  const [authStep, setAuthStep] = useState<'ACCESS_CODE' | 'SOCIAL_LOGIN'>(
    'SOCIAL_LOGIN'
  );
  
  const [accessCodeInput, setAccessCodeInput] = useState('');
  const [toast, setToast] = useState({ show: false, msg: '' });
  
  const [coordinatorData, setCoordinatorData] = useState<AuthUser | null>(null);

  const denyCoordinatorAccess = () => {
    setCoordinator(null);
    setCoordinatorData(null);
    setView('LANDING');
    setAuthStep('SOCIAL_LOGIN');
    if (window.location.hash === '#/coordinator') window.location.hash = '';
  };

  const openCoordinatorDashboard = async (user: NonNullable<typeof auth.currentUser>) => {
    if (!user.email) {
      denyCoordinatorAccess();
      return;
    }
    const storedUser = await DataService.getUser(user.email).catch(() => null);
    const profile: AuthUser = storedUser || {
      email: user.email.toLowerCase(),
      nombre: user.displayName || 'Coordinador'
    };
    setCoordinator({ nombre: profile.nombre, email: profile.email });
    setCoordinatorData(profile);
    setView('COORDINATOR');
    window.location.hash = '#/coordinator';
  };

  const checkCoordinatorStatus = async (user: NonNullable<typeof auth.currentUser>) => {
    if (isPatientSessionHash()) return;
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/coordinator-access/status', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.authorized === true) {
        await openCoordinatorDashboard(user);
        return;
      }
      if (response.ok && data.status === 'second_factor_required') {
        setCoordinator(null);
        setCoordinatorData(null);
        setView('LANDING');
        setAuthStep('ACCESS_CODE');
        return;
      }
      denyCoordinatorAccess();
      showToast('Acceso no autorizado.');
    } catch (error) {
      console.error('Error comprobando autorización de coordinador', error instanceof Error ? error.name : 'unknown');
      denyCoordinatorAccess();
      showToast('Acceso no autorizado.');
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      const hash = window.location.hash;
      const isPatientSession = hash.startsWith('#/session') || hash.startsWith('#/conclusion');
      if (isPatientSession) return;

      if (user) {
        await checkCoordinatorStatus(user);
      } else {
        denyCoordinatorAccess();
      }
    });

    const handleHashChange = () => {
      const hash = window.location.hash;
      if (hash.startsWith('#/session')) {
        const parts = hash.split('?');
        if (parts.length > 1) {
            const params = new URLSearchParams(parts[1]);
            const pEncoded = params.get('p');
            if (pEncoded) {
              try {
                // Usamos el decodificador seguro
                const decodedText = safeAtob(pEncoded);
                const decoded = JSON.parse(decodedText);
                
                console.log("[PATIENT LINK] decoded session token", {
                  hasId: !!decoded.id,
                  idPreview: decoded.id ? String(decoded.id).slice(0, 20) : null
                });

                if (!decoded.id) {
                  console.error("Link de sesión sin id de paciente", decoded);
                  setView('LANDING');
                  setToast({ show: true, msg: "Este enlace de cuestionario no es válido o está incompleto." });
                  return;
                }

                // Aseguramos que el ID esté presente en los datos del paciente y use el ID decodificado
                setPatientData({ ...decoded, id: decoded.id });
                setIsEditorMode(false);
                setView('PATIENT_SESSION');
              } catch (e) {
                console.error("Link de sesión no válido", e);
                setView('LANDING');
              }
            }
        }
      } else if (hash.startsWith('#/conclusion')) {
          const parts = hash.split('?');
          if (parts.length > 1) {
              const params = new URLSearchParams(parts[1]);
              const id = params.get('id');
              if (id) {
                  setConclusionPatientId(id);
                  setView('CONCLUSION_VIEW');
              } else {
                  setView('LANDING');
              }
          }
      } else if (hash === '#/coordinator') {
        setView('LANDING');
        if (auth.currentUser) void checkCoordinatorStatus(auth.currentUser);
        else denyCoordinatorAccess();
      } else if (!hash || hash === '#/') {
        setView('LANDING');
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    handleHashChange();
    return () => {
      unsubscribe();
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  const showToast = (msg: string) => {
    setToast({ show: true, msg });
  };

  const isPatientSessionHash = () => {
    return window.location.hash.startsWith('#/session') || window.location.hash.startsWith('#/conclusion');
  };

  const handleAccessCodeSubmit = async () => {
      if (isPatientSessionHash()) {
          showToast("Este enlace es solo para realizar el Cuestionario Espejo. Introduce la clave personal recibida con tu enlace.");
          return;
      }
      const user = auth.currentUser;
      if (!user) {
        denyCoordinatorAccess();
        showToast('Acceso no autorizado.');
        return;
      }
      try {
        const token = await user.getIdToken();
        const response = await fetch('/api/coordinator-access/verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ code: accessCodeInput })
        });
        const data = await response.json().catch(() => ({}));
        setAccessCodeInput('');
        if (response.ok && data.authorized === true) {
          showToast('Código aceptado');
          await openCoordinatorDashboard(user);
          return;
        }
        if (response.status === 429) {
          showToast('Demasiados intentos. Inténtalo de nuevo más tarde.');
          return;
        }
        if (response.status === 403 && data.status === 'verification_failed') {
          showToast('Código de acceso incorrecto');
          return;
        }
        denyCoordinatorAccess();
        showToast('Acceso no autorizado.');
      } catch (error) {
        console.error('Error verificando acceso de coordinador', error instanceof Error ? error.name : 'unknown');
        setAccessCodeInput('');
        denyCoordinatorAccess();
        showToast('Acceso no autorizado.');
      }
  };

  const handleGoogleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      showToast("Abriendo Google Login...");
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      showToast("Sesión iniciada. Cargando perfil...");
      await checkCoordinatorStatus(user);
    } catch (error: any) {
      console.error("Error Google Login:", error);
      if (error.code === 'auth/popup-blocked') {
          showToast("El navegador ha bloqueado la ventana flotante. Por favor, permite las ventanas emergentes.");
      } else {
          showToast("Error al iniciar sesión con Google");
      }
    }
  };

  const handleLogout = async () => {
    try {
      const user = auth.currentUser;
      if (user) {
        const token = await user.getIdToken();
        await fetch('/api/coordinator-access/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        });
      }
    } catch (error) {
      console.error('Error cerrando sesión secundaria', error instanceof Error ? error.name : 'unknown');
    } finally {
      await signOut(auth);
      setCoordinator(null);
      setCoordinatorData(null);
      setView('LANDING');
      setAuthStep('SOCIAL_LOGIN');
      setAccessCodeInput('');
      window.location.hash = '';
    }
  };

  const enterEditMode = () => {
    setIsEditorMode(true);
    setView('PATIENT_SESSION');
  };

  return (
    // IMPORTANTE: Eliminado overflow-y-auto para restaurar el scroll nativo de la ventana
    <div className="min-h-screen text-slate-800 overflow-x-hidden font-sans luxury-leather-bg">
      {view === 'LANDING' && (
        <div className="min-h-screen flex items-center justify-center flex-col p-6 text-center space-y-8 animate-in fade-in duration-1000 pb-20 relative">
           
           {/* Decoración de fondo sutil para Landing eliminada por preferir luxury-leather-bg estricto */}
           
           <div className="max-w-xl w-full relative z-10">
             <Logo />

             {authStep === 'ACCESS_CODE' && (
                <Card className="mt-12 animate-in zoom-in-95 duration-500 shadow-2xl border-white/80 bg-white/90">
                    <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4 text-xl">
                        <i className="fas fa-lock"></i>
                    </div>
                    <h3 className="text-2xl font-bold text-blue-900 mb-2">Acceso de Seguridad</h3>
                    <p className="text-sm text-slate-500 mb-6 font-medium">Introduce la clave general para continuar.</p>
                    <Input 
                        label="Código de Acceso" 
                        type="password" 
                        placeholder="*****"
                        maxLength={5}
                        className="text-center tracking-[0.5em] text-lg"
                        value={accessCodeInput} 
                        onChange={e => setAccessCodeInput(e.target.value.replace(/\D/g, ''))} 
                        onKeyDown={e => e.key === 'Enter' && handleAccessCodeSubmit()}
                        autoComplete="new-password"
                        name={accessCodeInputNameRef.current}
                        inputMode="numeric"
                        onFocus={() => setAccessCodeInput('')}
                    />
                    <Button className="w-full mt-4 py-4 text-lg" onClick={handleAccessCodeSubmit}>Verificar</Button>
                </Card>
             )}
             
             {authStep === 'SOCIAL_LOGIN' && (
               <Card className="mt-12 animate-in zoom-in-95 duration-500 shadow-2xl border-white/80 bg-white/90">
                 <h3 className="text-3xl font-bold text-blue-900 mb-6">Iniciar Sesión</h3>
                 <p className="text-base text-slate-500 mb-8 font-medium">Acceso 100% seguro mediante Google.</p>
                 
                 <Button variant="outline" className="w-full py-5 flex items-center justify-center space-x-3 border-slate-200 hover:bg-slate-50 text-lg" onClick={handleGoogleLogin}>
                     <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-6 h-6" alt="Google" referrerPolicy="no-referrer" />
                     <span>Acceder con Google</span>
                 </Button>
               </Card>
             )}

           </div>
        </div>
      )}

      {view === 'COORDINATOR' && coordinator && (
        <CoordinatorDashboard 
          profile={coordinator} 
          fullProfile={coordinatorData}
          onProfileUpdate={(data) => setCoordinatorData(prev => prev ? { ...prev, ...data } : null)}
          onLogout={handleLogout} 
          onEnterEditMode={enterEditMode}
        />
      )}
      
      {view === 'PATIENT_SESSION' && (
        isEditorMode || patientData.id ? (
          <PatientInterface 
            patientData={patientData} 
            isEditorMode={isEditorMode}
            onExitEditor={() => {
              setIsEditorMode(false);
              setView('COORDINATOR');
              window.location.hash = '#/coordinator';
            }}
          />
        ) : (
          <div className="min-h-screen flex items-center justify-center font-sans luxury-leather-bg">
              <div className="text-center space-y-4 animate-in fade-in duration-500">
                  <div className="w-12 h-12 border-4 border-amber-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
                  <p className="text-amber-800 font-medium">Preparando acceso seguro...</p>
              </div>
          </div>
        )
      )}
      
      {view === 'CONCLUSION_VIEW' && conclusionPatientId && (
          <ConclusionPatientView patientId={conclusionPatientId} />
      )}

      <Toast message={toast.msg} visible={toast.show} onHide={() => setToast({ ...toast, show: false })} />
    </div>
  );
};

export default App;
