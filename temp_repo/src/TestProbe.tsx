
import React, { useEffect, useState } from 'react';
import { DataService } from '../services/dataService';
import { db } from '../services/firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';

export default function TestProbe() {
  const [status, setStatus] = useState<string>('Iniciando prueba...');
  const [results, setResults] = useState<any[]>([]);

  useEffect(() => {
    const runTest = async () => {
      try {
        // 1. Prueba de escritura en audios/test_probe
        setStatus('Probando escritura en audios/test_probe...');
        const testAudioId = 'test_probe_' + Date.now();
        const testAudioData = 'data:audio/webm;base64,GkXfo59ChoEBQveBAULYGQ...'; // Mock small audio
        
        await setDoc(doc(db!, 'audios', testAudioId), { data: testAudioData });
        setResults(prev => [...prev, { test: 'Escritura en audios', status: 'OK', id: testAudioId }]);

        // 2. Prueba de guardado de cuestionario con audio (verificar referencias)
        setStatus('Probando guardado de cuestionario con audio...');
        const mockQuestions = [
          {
            id: 'test_q_1',
            text: 'Pregunta de prueba',
            audio: {
              female: 'data:audio/webm;base64,GkXfo59ChoEBQveBAULYGQ...', // Base64 que debe convertirse en ref
              male: 'data:audio/webm;base64,GkXfo59ChoEBQveBAULYGQ...'
            },
            options: []
          }
        ];

        await DataService.saveQuestions(mockQuestions as any);
        
        // Verificar que questionnaires/active tiene referencias y no Base64
        const activeDoc = await getDoc(doc(db!, 'questionnaires', 'active'));
        if (activeDoc.exists()) {
          const data = activeDoc.data();
          const firstQ = data.questions[0];
          const hasRefs = typeof firstQ.audio.female === 'string' && firstQ.audio.female.startsWith('audio_ref_');
          setResults(prev => [...prev, { 
            test: 'Cuestionario guarda referencias', 
            status: hasRefs ? 'OK' : 'FALLO', 
            value: firstQ.audio.female 
          }]);
        }

        setStatus('Pruebas completadas.');
      } catch (error: any) {
        console.error("Error en TestProbe:", error);
        setStatus('Error en las pruebas.');
        setResults(prev => [...prev, { test: 'Error general', status: 'ERROR', message: error.message }]);
      }
    };

    runTest();
  }, []);

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>Sonda de Prueba Firestore</h1>
      <p><strong>Estado:</strong> {status}</p>
      <div style={{ marginTop: '20px' }}>
        {results.map((r, i) => (
          <div key={i} style={{ 
            padding: '10px', 
            marginBottom: '10px', 
            border: '1px solid #ccc',
            backgroundColor: r.status === 'OK' ? '#e6fffa' : '#fff5f5'
          }}>
            <strong>{r.test}:</strong> {r.status}
            {r.id && <div>ID: {r.id}</div>}
            {r.value && <div>Valor: {r.value}</div>}
            {r.message && <div style={{ color: 'red' }}>{r.message}</div>}
          </div>
        ))}
      </div>
      <button onClick={() => window.location.reload()} style={{ marginTop: '20px' }}>Reiniciar Prueba</button>
    </div>
  );
}
