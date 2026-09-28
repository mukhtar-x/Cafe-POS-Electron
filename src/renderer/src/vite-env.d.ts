/// <reference types="vite/client" />
import { PosApi } from '../../preload/index';

declare global {
  interface Window {
    api?: PosApi;
  }
}
