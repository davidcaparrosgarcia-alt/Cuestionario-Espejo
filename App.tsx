import React, { useState, useEffect, useRef } from 'react';
import { CoordinatorDashboard } from './components/CoordinatorDashboard';
import { PatientInterface } from './components/PatientInterface';
import { ConclusionPatientView } from './components/ConclusionPatientView';
import { View, PatientData, CoordinatorProfile, AuthUser } from './types';
import { Button, Logo, Input, Card, Toast } from './components/UI';
import { auth } from './services/firebase';
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut,
  GoogleAuthProvider,
  signInWithPopup
} from 'firebase/auth';
import { doc, getDocFromServer, setDoc } from 'firebase/firestore';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import { db, storage } from './services/firebase';
import { DataService } from './services/dataService';

// Credenciales Maestras (Mantener como fallback o admin por defecto si es necesario)
const MASTER_USER = {
  email: 'cuestionarioespejo@gmail.com',
  pin: '66099',
  nombre: 'Administrador Maestro'
};

const DEFAULT_ACCESS_CODE = '66099';
const ACCESS_VERIFIED_SESSION_KEY = 'ce_access_verified_this_tab';
const ACCESS_RELOAD_MARKER_KEY = 'ce_access_reload_marker';

const getNavigationType = () => {
  if (typeof window === 'undefined') return 'navigate';
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  return nav?.type || 'navigate';
};

const shouldRestoreAccessAfterReload = () => {
  if (typeof window === 'undefined') return false;

  const navigationType = getNavigationType();
  const hadVerifiedAccess = window.sessionStorage.getItem(ACCESS_VERIFIED_SESSION_KEY) === 'true';
  const hadReloadMarker = window.sessionStorage.getItem(ACCESS_RELOAD_MARKER_KEY) === 'true';

  return navigationType === 'reload' && hadVerifiedAccess && hadReloadMarker;
};

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
    if (hash === '#/coordinator') return 'COORDINATOR'; // Will be verified by auth
    return 'LANDING';
  });
  const [patientData, setPatientData] = useState<Partial<PatientData>>({});
  const [coordinator, setCoordinator] = useState<CoordinatorProfile | null>(null);
  const [isEditorMode, setIsEditorMode] = useState(false);
  const [conclusionPatientId, setConclusionPatientId] = useState<string | null>(null);
  const [globalAccessCode, setGlobalAccessCode] = useState(DEFAULT_ACCESS_CODE);

  const initialAccessGranted = shouldRestoreAccessAfterReload();

  if (typeof window !== 'undefined' && !initialAccessGranted) {
    window.sessionStorage.removeItem(ACCESS_VERIFIED_SESSION_KEY);
    window.sessionStorage.removeItem(ACCESS_RELOAD_MARKER_KEY);
  }

  const [accessGrantedThisLoad, setAccessGrantedThisLoad] = useState(initialAccessGranted);
  const accessGrantedThisLoadRef = useRef(initialAccessGranted);
  const accessCodeInputNameRef = useRef(`ce-manual-${Math.random().toString(36).slice(2)}`);

  // Nuevo estado ACCESS_CODE al inicio
  const [authStep, setAuthStep] = useState<'ACCESS_CODE' | 'SOCIAL_LOGIN'>(
    initialAccessGranted ? 'SOCIAL_LOGIN' : 'ACCESS_CODE'
  );
  
  const [accessCodeInput, setAccessCodeInput] = useState('');
  const [toast, setToast] = useState({ show: false, msg: '' });
  
  const [coordinatorData, setCoordinatorData] = useState<AuthUser | null>(null);

  useEffect(() => {
    const fetchConfig = async () => {
        try {
            const config = await DataService.getGlobalConfig({} as any);
            if (config.accessCode) {
                setGlobalAccessCode(config.accessCode);
            }
        } catch (e) {
            console.error("Error fetching global config", e);
        }
    };
    fetchConfig();

    // Verificar si ya metió el código de acceso previamente en esta sesión
    setAuthStep(initialAccessGranted ? 'SOCIAL_LOGIN' : 'ACCESS_CODE');

    // Escuchar cambios en el estado de autenticación de Firebase
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      const isGranted = accessGrantedThisLoadRef.current;
      const hash = window.location.hash;
      const isPatientSession = hash.startsWith('#/session') || hash.startsWith('#/conclusion');
      
      if (user && user.email) {
        if (!isGranted) {
          // Si está logueado en Firebase pero no ha metido el código, forzamos LANDING
          setAuthStep('ACCESS_CODE');
          if (!isPatientSession) {
            setView('LANDING');
          }
          return;
        }

        // Si estamos en una sesión de paciente o conclusión, no redirigimos al dashboard
        if (isPatientSession) {
            return;
        }

        try {
          const userData = await DataService.getUser(user.email);
          if (userData) {
            setCoordinator({ nombre: userData.nombre, email: userData.email });
            setCoordinatorData(userData);
            setView('COORDINATOR');
            window.location.hash = '#/coordinator';
          } else {
            // Registro automático de Google
            const newUser: AuthUser = {
              email: user.email,
              nombre: user.displayName || 'Coordinador',
              pin: 'GOOGLE',
              securityQuestion: 'Google Auth',
              securityAnswer: 'google'
            };
            await DataService.saveUser(newUser);
            setCoordinator({ nombre: newUser.nombre, email: newUser.email });
            setCoordinatorData(newUser);
            setView('COORDINATOR');
            window.location.hash = '#/coordinator';
          }
        } catch (error) {
          console.error("Error al obtener datos del usuario", error);
          setCoordinator({ nombre: user.displayName || 'Coordinador', email: user.email });
          setView('COORDINATOR');
          window.location.hash = '#/coordinator';
        }
      } else {
        setCoordinator(null);
        // Solo redirigimos a LANDING si no estamos viendo un paciente o conclusión
        if (!hash.startsWith('#/session') && !hash.startsWith('#/conclusion')) {
            setView('LANDING');
        }
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
        const isGranted = accessGrantedThisLoadRef.current;

        if (auth.currentUser && isGranted) {
          setView('COORDINATOR');
        } else {
          setCoordinator(null);
          setCoordinatorData(null);
          setView('LANDING');
          setAuthStep('ACCESS_CODE');
          window.location.hash = '';
        }
      } else if (!hash || hash === '#/') {
        setView('LANDING');
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    handleHashChange();
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    const markPotentialReload = () => {
      if (accessGrantedThisLoadRef.current) {
        window.sessionStorage.setItem(ACCESS_RELOAD_MARKER_KEY, 'true');
      }
    };

    window.addEventListener('beforeunload', markPotentialReload);

    return () => {
      window.removeEventListener('beforeunload', markPotentialReload);
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
      if (accessCodeInput === globalAccessCode) {
          setAccessGrantedThisLoad(true);
          accessGrantedThisLoadRef.current = true;
          window.sessionStorage.setItem(ACCESS_VERIFIED_SESSION_KEY, 'true');
          window.sessionStorage.removeItem(ACCESS_RELOAD_MARKER_KEY);
          setAuthStep('SOCIAL_LOGIN');
          setAccessCodeInput('');
          showToast("Código aceptado");
          
          // Si ya está logueado en Firebase, forzamos la carga de datos
          if (auth.currentUser && auth.currentUser.email) {
              const user = auth.currentUser;
              try {
                  const userData = await DataService.getUser(user.email);
                  if (userData) {
                      setCoordinator({ nombre: userData.nombre, email: userData.email });
                      setCoordinatorData(userData);
                      setView('COORDINATOR');
                      window.location.hash = '#/coordinator';
                  } else {
                      const newUser: AuthUser = {
                          email: user.email,
                          nombre: user.displayName || 'Coordinador',
                          pin: 'GOOGLE',
                          securityQuestion: 'Google Auth',
                          securityAnswer: 'google'
                      };
                      await DataService.saveUser(newUser);
                      setCoordinator({ nombre: newUser.nombre, email: newUser.email });
                      setCoordinatorData(newUser);
                      setView('COORDINATOR');
                      window.location.hash = '#/coordinator';
                  }
              } catch (e) {
                  console.error("Error al cargar usuario tras código", e);
                  setCoordinator({ nombre: user.displayName || 'Coordinador', email: user.email });
                  setView('COORDINATOR');
                  window.location.hash = '#/coordinator';
              }
          }
      } else {
          showToast("Código de acceso incorrecto");
          setAccessCodeInput('');
          window.sessionStorage.removeItem(ACCESS_VERIFIED_SESSION_KEY);
          window.sessionStorage.removeItem(ACCESS_RELOAD_MARKER_KEY);
          setAccessGrantedThisLoad(false);
          accessGrantedThisLoadRef.current = false;
      }
  };

  const handleGoogleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      showToast("Abriendo Google Login...");
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      showToast("Sesión iniciada. Cargando perfil...");
      
      if (user && user.email) {
          try {
              const userData = await DataService.getUser(user.email);
              if (userData) {
                  setCoordinator({ nombre: userData.nombre, email: userData.email });
                  setCoordinatorData(userData);
                  setView('COORDINATOR');
                  window.location.hash = '#/coordinator';
              } else {
                  const newUser: AuthUser = {
                      email: user.email,
                      nombre: user.displayName || 'Coordinador',
                      pin: 'GOOGLE',
                      securityQuestion: 'Google Auth',
                      securityAnswer: 'google'
                  };
                  await DataService.saveUser(newUser);
                  setCoordinator({ nombre: newUser.nombre, email: newUser.email });
                  setCoordinatorData(newUser);
                  setView('COORDINATOR');
                  window.location.hash = '#/coordinator';
              }
          } catch (e) {
              console.error("Error al cargar usuario tras login de Google", e);
              setCoordinator({ nombre: user.displayName || 'Coordinador', email: user.email });
              setView('COORDINATOR');
              window.location.hash = '#/coordinator';
          }
      }
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
      await signOut(auth);
      setCoordinator(null);
      setView('LANDING');
      window.sessionStorage.removeItem(ACCESS_VERIFIED_SESSION_KEY);
      window.sessionStorage.removeItem(ACCESS_RELOAD_MARKER_KEY);
      setAccessGrantedThisLoad(false);
      accessGrantedThisLoadRef.current = false;
      setAuthStep('ACCESS_CODE');
      setAccessCodeInput('');
      window.location.hash = '';
    } catch (e) {
      showToast("Error al cerrar sesión");
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
                 <div className="flex justify-start mb-4">
                   <button onClick={() => setAuthStep('ACCESS_CODE')} className="text-sm text-blue-600 font-bold hover:underline"><i className="fas fa-arrow-left"></i> Volver</button>
                 </div>
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
