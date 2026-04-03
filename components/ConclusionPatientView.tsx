
import React, { useState, useEffect, useRef } from 'react';
import { Card, Button, Logo, Input } from './UI';
import { PatientData } from '../types';
import { DataService } from '../services/dataService';

interface ConclusionPatientViewProps {
  patientId: string;
}

export const ConclusionPatientView: React.FC<ConclusionPatientViewProps> = ({ patientId }) => {
  const [patient, setPatient] = useState<PatientData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  
  // Estados de seguridad (PIN)
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // Cargar pacientes
    const loadData = async () => {
        try {
            const found = await DataService.getPatientById(patientId);
            
            if (found) {
                // Si ya ha sido visto demasiadas veces, marcar expirado
                if ((found.conclusionViews || 0) >= 2) {
                    setExpired(true);
                    setLoading(false);
                } else {
                    setPatient(found);
                    setLoading(false);
                }
            } else {
                setError("No se ha encontrado el registro.");
                setLoading(false);
            }
        } catch (e) {
            setError("Error al cargar la conclusión.");
            setLoading(false);
        }
    };

    loadData();
  }, [patientId]);

  const verifyPin = async () => {
      if (patient && pinInput === patient.accessPin) {
          setIsUnlocked(true);
          
          // Incrementar contador de vistas al desbloquear con éxito
          try {
             await DataService.updatePatient(patientId, { 
                 conclusionViews: (patient.conclusionViews || 0) + 1,
                 status: 'finalized' as const,
                 dateConclusionViewed: Date.now()
             });
          } catch(e) {
             console.error("Error actualizando vistas", e);
          }

      } else {
          setPinError(true);
          setTimeout(() => setPinError(false), 2000);
      }
  };

  const handleBooking = () => window.location.href = "https://example.com/reserva"; 
  const handleLearnMore = () => window.location.href = "https://example.com/terapias";
  const handlePlayAudio = () => audioRef.current?.play();

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-[#faf9f6]"><div className="animate-spin w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full"></div></div>;

  if (expired) return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#faf9f6]">
       <Card className="text-center max-w-lg w-full py-12 px-8">
           <div className="w-20 h-20 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-6 text-3xl"><i className="fas fa-lock"></i></div>
           <h2 className="text-2xl font-bold mb-4">Enlace Caducado</h2>
           <p className="text-slate-500 mb-8">Por seguridad, este enlace ha expirado tras alcanzar el límite de visualizaciones permitidas.</p>
           <Button onClick={handleBooking} className="w-full py-4 text-lg bg-blue-600">Reserva Ahora</Button>
       </Card>
    </div>
  );

  if (!patient) return <div className="min-h-screen flex items-center justify-center bg-[#faf9f6]"><h2>{error || "Error"}</h2></div>;

  // PANTALLA DE BLOQUEO POR PIN
  if (!isUnlocked) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4 relative font-sans bg-[#faf9f6]">
            <div className="absolute inset-0 z-0 bg-cover bg-center opacity-60" style={{ backgroundImage: "url('assets/fondoconclusion.webp')" }}></div>
            <Card className="max-w-md w-full p-10 relative z-10 text-center shadow-2xl border-white/50 backdrop-blur-md bg-white/90">
                <Logo />
                <div className="mt-8 mb-6">
                    <h3 className="text-xl font-bold text-blue-900 mb-2">Acceso Protegido</h3>
                    <p className="text-sm text-slate-500 font-medium">Introduce la clave de 4 dígitos que se te entregó al iniciar el cuestionario.</p>
                </div>
                <div className="mb-8">
                    <input 
                        type="password" 
                        maxLength={4} 
                        className={`w-full text-center text-4xl tracking-[0.5em] p-5 rounded-2xl border-2 outline-none transition-all ${pinError ? 'border-red-500 bg-red-50' : 'border-blue-100 focus:border-blue-500 bg-white'}`}
                        placeholder="****"
                        value={pinInput}
                        onChange={e => setPinInput(e.target.value.replace(/\D/g, ''))}
                        onKeyPress={e => e.key === 'Enter' && pinInput.length === 4 && verifyPin()}
                    />
                    {pinError && <p className="text-red-500 text-xs font-bold mt-2 animate-pulse">Clave incorrecta</p>}
                </div>
                <Button onClick={verifyPin} disabled={pinInput.length < 4} className="w-full py-4 text-lg">Ver mis resultados</Button>
            </Card>
        </div>
      );
  }

  // PANTALLA DE CONCLUSIÓN (DESBLOQUEADA)
  return (
    <div className="min-h-screen bg-[#faf9f6] relative font-sans overflow-x-hidden">
        <div 
            className="absolute inset-0 z-0 bg-cover bg-center opacity-70" 
            style={{ backgroundImage: "url('assets/fondoconclusion.webp')" }}
        >
            <div className="absolute inset-0 bg-white/40 backdrop-blur-sm"></div>
        </div>

        {patient.audioConclusion && <audio ref={audioRef} src={patient.audioConclusion} className="hidden" />}

        <div className="max-w-4xl mx-auto relative z-10 p-4 md:p-8">
            <div className="mb-10 text-center animate-in fade-in slide-in-from-top-4"><Logo /></div>
            
            <Card className="mb-12 border-none shadow-2xl overflow-hidden relative animate-in fade-in zoom-in-95 duration-700 bg-white/95">
                <div className="bg-gradient-to-r from-blue-900 to-indigo-900 p-8 md:p-14 text-white relative">
                    <div className="relative z-10">
                        <h2 className="text-3xl md:text-5xl font-friendly font-bold mb-4 leading-tight">Análisis Terapéutico</h2>
                        <p className="text-blue-100 text-lg">Preparado para: <span className="font-bold text-white ml-2 uppercase tracking-wide">{patient.nombre}</span></p>
                    </div>

                    {patient.audioConclusion && (
                        <button 
                            onClick={handlePlayAudio}
                            className="absolute top-8 right-8 z-20 w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-lg text-blue-600 hover:scale-110 active:scale-95 transition-all cursor-pointer"
                            title="Escuchar Conclusión"
                        >
                            <i className="fas fa-play text-2xl ml-1"></i>
                        </button>
                    )}
                </div>
                
                <div className="p-8 md:p-14">
                    <div className="prose prose-lg prose-slate max-w-none text-slate-700 leading-loose whitespace-pre-line text-justify font-medium">
                        {patient.finalConclusion || patient.conversationSummary || "Estamos terminando de procesar tu informe."}
                    </div>
                </div>

                <div className="bg-blue-50/80 p-6 flex items-center justify-center gap-3 text-blue-900 text-sm font-bold border-t border-blue-100 backdrop-blur-md">
                    <i className="fas fa-shield-alt text-blue-500"></i>
                    <span>Acceso verificado.</span>
                </div>
            </Card>

            <div className="text-center space-y-12 animate-in slide-in-from-bottom-8 duration-1000 delay-300 mb-24">
                <div className="space-y-4">
                    <h3 className="text-3xl md:text-4xl font-friendly font-bold text-slate-800">Tu transformación empieza hoy</h3>
                    <p className="text-slate-600 text-lg max-w-2xl mx-auto font-medium">Descubre el camino hacia tu mejor versión con nuestro apoyo experto.</p>
                </div>
                <div className="flex flex-col md:flex-row items-center justify-center gap-6 px-4">
                    <button 
                        onClick={handleBooking}
                        className="w-full md:w-auto px-10 py-6 text-xl font-black rounded-3xl bg-gradient-to-r from-blue-600 to-indigo-700 text-white shadow-2xl hover:scale-105 active:scale-95 transition-all animate-pulse border-none cursor-pointer flex items-center justify-center gap-3"
                    >
                        <i className="fas fa-calendar-check text-2xl"></i> Reservar terapia
                    </button>
                    <button 
                        onClick={handleLearnMore}
                        className="w-full md:w-auto px-10 py-6 text-lg font-bold rounded-3xl bg-white text-indigo-700 border-2 border-indigo-100 shadow-xl hover:bg-indigo-50 transition-all cursor-pointer flex items-center justify-center gap-3"
                    >
                        <i className="fas fa-info-circle text-xl"></i> Conocer más sobre las terapias
                    </button>
                </div>
            </div>
        </div>
    </div>
  );
};
