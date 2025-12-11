import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class SettingsService {
  private fontSizeSubject = new BehaviorSubject<'small' | 'large'>('large');
  private showSimplifiedSubject = new BehaviorSubject<boolean>(true);

  constructor() {
    // Load from localStorage
    const savedFontSize = localStorage.getItem('fontSize') as 'small' | 'large' | null;
    if (savedFontSize) {
      this.fontSizeSubject.next(savedFontSize);
    }

    const savedShowSimplified = localStorage.getItem('showSimplified');
    if (savedShowSimplified !== null) {
      this.showSimplifiedSubject.next(savedShowSimplified === 'true');
    }
  }

  getFontSize(): 'small' | 'large' {
    return this.fontSizeSubject.value;
  }

  setFontSize(size: 'small' | 'large') {
    this.fontSizeSubject.next(size);
    localStorage.setItem('fontSize', size);
  }

  getFontSize$(): Observable<'small' | 'large'> {
    return this.fontSizeSubject.asObservable();
  }

  getShowSimplified(): boolean {
    return this.showSimplifiedSubject.value;
  }

  setShowSimplified(showSimplified: boolean) {
    this.showSimplifiedSubject.next(showSimplified);
    localStorage.setItem('showSimplified', showSimplified.toString());
  }

  getShowSimplified$(): Observable<boolean> {
    return this.showSimplifiedSubject.asObservable();
  }
}
