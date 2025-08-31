declare module "googleapis" {
  export const google: any;
}

declare module "zod" {
  export const z: any;
}

declare module "@supabase/supabase-js" {
  export function createClient(url: string, key: string, opts?: any): any;
}

declare module "date-fns" {
  export const addMinutes: any;
}

declare module "jsonwebtoken" {
  export function sign(...args: any[]): any;
  export function verify(...args: any[]): any;
}
