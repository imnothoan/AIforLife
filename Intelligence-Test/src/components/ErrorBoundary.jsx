// ============================================
// ERROR BOUNDARY COMPONENT
// Catches and handles React errors gracefully
// ============================================

import React from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { t } from '../lib/i18n';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { 
      hasError: false, 
      error: null, 
      errorInfo: null 
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Log error to console (in production, send to error tracking service)
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({ errorInfo });
    
    // In production, you would send this to an error tracking service like Sentry
    // if (process.env.NODE_ENV === 'production') {
    //   Sentry.captureException(error, { extra: errorInfo });
    // }
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-red-50 to-orange-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-8 text-center">
            {/* Error Icon */}
            <div className="inline-flex items-center justify-center w-16 h-16 bg-red-100 rounded-full mb-6">
              <AlertTriangle className="w-8 h-8 text-red-600" />
            </div>
            
            {/* Error Title */}
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              {t('errorBoundary.title')}
            </h1>
            
            {/* Error Description */}
            <p className="text-gray-600 mb-6">
              {t('errorBoundary.description')}
            </p>
            
            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={this.handleReload}
                className="inline-flex items-center justify-center px-6 py-3 bg-primary text-white font-medium rounded-xl hover:bg-primary-dark transition-colors"
              >
                <RefreshCw className="w-5 h-5 mr-2" />
                {t('errorBoundary.reload')}
              </button>
              
              <button
                onClick={this.handleGoHome}
                className="inline-flex items-center justify-center px-6 py-3 bg-gray-100 text-gray-700 font-medium rounded-xl hover:bg-gray-200 transition-colors"
              >
                <Home className="w-5 h-5 mr-2" />
                {t('errorBoundary.home')}
              </button>
            </div>
            
            {/* Technical Details (collapsible in production) */}
            {import.meta.env.DEV && this.state.error && (
              <details className="mt-6 text-left">
                <summary className="text-sm text-gray-500 cursor-pointer hover:text-gray-700">
                  {t('errorBoundary.technicalDetails')}
                </summary>
                <div className="mt-2 p-4 bg-gray-50 rounded-lg overflow-auto text-xs text-gray-600 font-mono">
                  <p className="font-bold text-red-600 mb-2">
                    {this.state.error.toString()}
                  </p>
                  {this.state.errorInfo && (
                    <pre className="whitespace-pre-wrap">
                      {this.state.errorInfo.componentStack}
                    </pre>
                  )}
                </div>
              </details>
            )}
            
            {/* Contact Support */}
            <p className="mt-6 text-sm text-gray-500">
              {t('errorBoundary.contactSupport')}
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
