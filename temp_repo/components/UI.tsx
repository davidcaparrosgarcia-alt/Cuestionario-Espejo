
import React, { useState, useEffect } from 'react';

export const Card: React.FC<{ children: React.ReactNode, className?: string }> = ({ children, className }) => (
  // Se ha cambiado la opacidad base y añadido backdrop-blur para el efecto cristal
  <div className={`bg-white/80 backdrop-blur-xl rounded-[2.5rem] shadow-2xl border border-white/60 p-6 md:p-8 ${className}`}>
    {children}
  </div>
);

export const Button: React.FC<{ 
  onClick?: () => void, 
  variant?: 'primary' | 'secondary' | 'outline' | 'google' | 'danger', 
  children: React.ReactNode,
  className?: string,
  disabled?: boolean
}> = ({ onClick, variant = 'primary', children, className, disabled }) => {
  const variants = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 shadow-xl shadow-blue-600/20 active:bg-blue-800',
    secondary: 'bg-indigo-900 text-white hover:bg-indigo-950 shadow-xl shadow-indigo-900/20 active:bg-indigo-950',
    outline: 'border-2 border-blue-600 text-blue-600 hover:bg-blue-50 active:bg-blue-100',
    google: 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 shadow-sm flex items-center justify-center gap-2',
    danger: 'bg-red-50 text-red-600 hover:bg-red-100'
  };

  return (
    <button 
      disabled={disabled}
      onClick={onClick}
      className={`px-6 py-4 rounded-2xl font-bold transition-all transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    >
      {variant === 'google' && (
        <svg className="w-5 h-5" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
      )}
      {children}
    </button>
  );
};

export const ProgressBar: React.FC<{ current: number, total: number }> = ({ current, total }) => {
  const percentage = Math.min(100, Math.max(0, (current / total) * 100));
  return (
    <div className="w-full bg-white/50 backdrop-blur-sm rounded-full h-3 overflow-hidden shadow-inner border border-white/50">
      <div 
        className="bg-gradient-to-r from-blue-400 to-blue-600 h-full transition-all duration-1000 ease-out shadow-lg"
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
};

export const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { label: string }> = ({ label, ...props }) => (
  <div className="mb-4">
    <label className="block text-[11px] font-black uppercase text-slate-500 mb-2 tracking-widest">{label}</label>
    <input 
      {...props}
      className="w-full px-5 py-4 rounded-2xl border-2 border-slate-100 focus:border-blue-500 outline-none transition-all bg-white/60 backdrop-blur-md text-sm font-bold shadow-inner"
    />
  </div>
);

export const Logo: React.FC<{ size?: 'sm' | 'lg', isDark?: boolean }> = ({ size = 'lg', isDark = false }) => (
  <div className={`flex items-center gap-3 ${size === 'lg' ? 'mb-8' : ''}`}>
    <div className="bg-blue-600 p-3 rounded-2xl text-white shadow-xl shadow-blue-600/30">
      <i className={`fas fa-magic ${size === 'lg' ? 'text-2xl' : 'text-lg'}`}></i>
    </div>
    <div>
      <h1 className={`${size === 'lg' ? 'text-3xl' : 'text-xl'} font-friendly font-black ${isDark ? 'text-white' : 'text-indigo-950'} leading-none`}>Cuestionario Espejo</h1>
      <p className={`text-[10px] uppercase tracking-[0.25em] font-black opacity-90 mt-1 ${isDark ? 'text-yellow-400' : 'text-blue-600'}`}>Naveguemos juntos</p>
    </div>
  </div>
);

export const Toast: React.FC<{ message: string, visible: boolean, onHide: () => void }> = ({ message, visible, onHide }) => {
  useEffect(() => {
    if (visible) {
      const timer = setTimeout(onHide, 3500);
      return () => clearTimeout(timer);
    }
  }, [visible, onHide]);

  if (!visible) return null;

  return (
    <div className="fixed top-8 left-1/2 -translate-x-1/2 z-[200] animate-in slide-in-from-top-4 duration-300">
      <div className="bg-slate-900 text-white px-8 py-4 rounded-3xl shadow-2xl flex items-center gap-4 border border-white/20">
        <div className="w-3 h-3 rounded-full bg-blue-400 animate-pulse shadow-[0_0_15px_rgba(59,130,246,0.5)]" />
        <p className="text-sm font-bold tracking-tight">{message}</p>
      </div>
    </div>
  );
};
