/** Integración real opt-in; red interrumpida en adaptador, nunca se simulan respuestas del backend. */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createApiClient, NetworkError } from '@/services/api/client';
import { createAuthService } from '@/services/auth/auth-service';
import { SessionManager, type SecureStorage } from '@/services/auth/session-manager';
import { createLibraryService } from '@/services/library/library-service';
import { createRepositories } from '@/db/repositories';
import { migrateDbIfNeeded } from '@/db/migrations';
import { uploadCover } from '@/services/device/cover-service';
import type { Book, Loan } from '@/types';
import { createTestDb } from '../test-utils/node-sqlite';
import { nodeFetch } from '../test-utils/node-fetch';
jest.mock('expo-image-picker',()=>({}));
jest.mock('expo-image-manipulator',()=>({}));
jest.mock('expo-file-system',()=>({}));
class MemoryStorage implements SecureStorage {
  data=new Map<string,string>();
  async getItemAsync(k:string){return this.data.get(k)??null;}
  async setItemAsync(k:string,v:string){this.data.set(k,v);}
  async deleteItemAsync(k:string){this.data.delete(k);}
}
const suite=process.env.E2E_D04==='1'?describe:describe.skip;
suite('D04 offline ⇄ producción propia',()=>{
  jest.setTimeout(150_000);
  it('persiste/reinicia, conflicto409 real, respuesta perdida sin duplicar y portada real',async()=>{
    const base=process.env.E2E_API_URL!;
    if(base!=='https://biblioteca-api-2026.vercel.app')throw new Error('Solo destino propio');
    const requests:{method:string;path:string;status:number;responseDropped?:boolean}[]=[];const checks:string[]=[];
    let network=true;let dropNextLoanResponse=false;
    const transport=(async(input:string,init:RequestInit)=>{
      if(!network)throw new NetworkError();
      const response=await nodeFetch(input,init);const url=new URL(input);
      const info={method:init.method??'GET',path:url.pathname.startsWith('/api/loans/')?'/api/loans/[id]':url.pathname,status:response.status,responseDropped:false};requests.push(info);
      if(dropNextLoanResponse&&url.pathname==='/api/loans'&&init.method==='POST'&&response.ok){dropNextLoanResponse=false;info.responseDropped=true;throw new NetworkError();}
      return response;
    })as typeof fetch;
    async function auth(email:string,password:string){
      const publicApi=createApiClient({baseUrl:base,timeoutMs:20000,fetchImpl:transport});
      const storage=new MemoryStorage();const session=new SessionManager(storage,publicApi);
      const user=await createAuthService(publicApi,session).signIn(email,password);
      const api=createApiClient({baseUrl:base,timeoutMs:20000,fetchImpl:transport,auth:{getAccessToken:()=>session.getAccessToken(),refreshSession:t=>session.refresh(t),getSessionKey:()=>session.getUser()?.uid??null}});
      return {user,api,session};
    }
    const a=await auth(process.env.E2E_STUDENT_EMAIL!,process.env.E2E_STUDENT_PASSWORD!);
    const b=await auth(process.env.E2E_AUX_EMAIL!,process.env.E2E_AUX_PASSWORD!);
    const librarian=await auth(process.env.E2E_LIBRARIAN_EMAIL!,process.env.E2E_LIBRARIAN_PASSWORD!);
    const filename=process.env.E2E_SQLITE_FILE!;let db=createTestDb(filename);await migrateDbIfNeeded(db);let repos=createRepositories(db);
    let time=Date.now();const now=()=>new Date(time);
    const create=()=>createLibraryService({api:a.api,repos,user:a.user,newId:()=>`d04-${randomUUID()}`,isCurrent:()=>a.session.getUser()?.uid===a.user.uid,now});
    let service=create();await service.initialize();
    let competitorId:string|null=null;
    try {
      expect(a.user.role).toBe('student');expect(b.user.role).toBe('student');expect(librarian.user.role).toBe('librarian');checks.push('Tres identidades reales de la aplicación, sin Admin en cliente');
      await service.refresh();const conflict=(await repos.books.getById(process.env.E2E_CONFLICT_BOOK!))!;
      expect(conflict.availableCopies).toBe(1);checks.push('Fixture aislada con1ejemplar descargada a SQLite');
      network=false;const local=await service.requestLoan(conflict);checks.push('Solicitud local sin red: no espera HTTP');
      expect((await repos.outbox.pending(a.user.uid))[0].clientRequestId).toBe(local.clientRequestId);expect(local.syncState).toBe('pending');checks.push('UUID y propietario persistidos; no se anuncia confirmación');
      await db.closeAsync();db=createTestDb(filename);await migrateDbIfNeeded(db);repos=createRepositories(db);service=create();await service.initialize();
      expect((await repos.outbox.pending(a.user.uid))[0].clientRequestId).toBe(local.clientRequestId);checks.push('Reapertura de archivo SQLite real conserva intención');
      network=true;
      const competitor=await b.api.post<{loan:Loan}>('/api/loans',{bookId:conflict.id,clientRequestId:`d04-${randomUUID()}`});competitorId=competitor.loan.id;
      await librarian.api.patch(`/api/loans/${competitorId}`,{action:'approve'});checks.push('Otra cuenta solicita y bibliotecario aprueba por API; sin forzar Firestore');
      await service.refresh();const conflicted=(await repos.loans.list(a.user.uid)).find(l=>l.clientRequestId===local.clientRequestId)!;
      expect(conflicted.syncState).toBe('conflict');expect(conflicted.syncError).toMatch(/ejemplares/);checks.push('409 NO_COPIES auténtico registrado y mostrado como conflicto');
      expect((await repos.outbox.recent(a.user.uid)).find(o=>o.clientRequestId===local.clientRequestId)?.state).toBe('conflict');checks.push('Resultado409 conservado en historial, sin borrar evidencia');
      expect((await repos.books.getById(conflict.id))?.availableCopies).toBe(0);checks.push('Catálogo incremental refleja stock0 decidido por servidor');
      await librarian.api.patch(`/api/loans/${competitorId}`,{action:'return'});competitorId=null;checks.push('Devolución real restituye ejemplar antes de limpiar fixture');
      const replay=(await repos.books.getById(process.env.E2E_REPLAY_BOOK!))!;
      const intention=await service.requestLoan(replay);dropNextLoanResponse=true;
      await expect(service.refresh()).rejects.toBeInstanceOf(NetworkError);checks.push('Respuesta201 real descartada en transporte tras procesar el servidor');
      expect(await repos.outbox.count(a.user.uid)).toBe(1);checks.push('Respuesta perdida conserva operación y clientRequestId');
      await db.closeAsync();db=createTestDb(filename);await migrateDbIfNeeded(db);repos=createRepositories(db);time+=31_000;service=create();await service.initialize();
      await service.refresh();const serverLoans=(await a.api.get<{loans:Loan[]}>('/api/loans')).loans;
      expect(serverLoans.filter(l=>l.clientRequestId===intention.clientRequestId)).toHaveLength(1);checks.push('Reinicio+reintento devuelve mismo préstamo:1documento real');
      const confirmed=(await repos.loans.list(a.user.uid)).filter(l=>l.clientRequestId===intention.clientRequestId);expect(confirmed).toHaveLength(1);expect(confirmed[0].syncState).toBe('synced');checks.push('Fila local pendiente reemplazada atómicamente por confirmación');
      expect(await repos.outbox.count(a.user.uid)).toBe(0);checks.push('Cola vacía tras confirmación, historial conservado');
      const savedCursor=await repos.meta.get('books.cursor');expect(Date.parse(savedCursor!)).toBeLessThan(Date.now()+60_000);expect(savedCursor).not.toBeNull();checks.push('Cursor incremental persistido con solape de1segundo');
      await expect(b.api.get(`/api/loans/${confirmed[0].id}`)).rejects.toMatchObject({status:404});checks.push('Otra cuenta recibe404 de operación confirmada ajena');
      expect(await repos.outbox.pending(b.user.uid)).toEqual([]);checks.push('Consulta local de cola por otra identidad vacía');
      const invalidActor=createLibraryService({api:b.api,repos,user:b.user,newId:randomUUID,isCurrent:()=>true});await expect(invalidActor.initialize()).rejects.toMatchObject({status:403});checks.push('Dueño distinto de SQLite rechazado antes de sincronizar');
      const before=(await librarian.api.get<{book:Book}>(`/api/books/${replay.id}`)).book;
      const image=readFileSync(process.env.E2E_COVER_FILE!).toString('base64');
      const updated=await uploadCover(librarian.api,repos.activity,replay.id,{base64:image,contentType:'image/jpeg',previewUri:''});
      expect(updated.coverUrl).not.toBe(before.coverUrl);checks.push('PUT portada JPEG real por contrato existente y rol librarian');
      const coverResponse=await nodeFetch(`${base}${updated.coverUrl}`);expect(coverResponse.status).toBe(200);expect(Buffer.from(await coverResponse.arrayBuffer()).toString('base64')).toBe(image);checks.push('GET público de portada devuelve mismosbytes preparados');
      await service.refresh();expect((await repos.books.getById(replay.id))?.coverUrl).toBe(updated.coverUrl);checks.push('Otro cliente recibe portada versionada en SQLite mediante incremental');
      await expect(a.api.put(`/api/books/${replay.id}/cover`,{contentType:'image/jpeg',data:image})).rejects.toMatchObject({status:403});checks.push('Servidor deniega portada student');
      await librarian.api.patch(`/api/loans/${confirmed[0].id}`,{action:'reject'});checks.push('Fixture solicitada cierra por rechazo real sin descontar inventario');
      const catalog=(await a.api.get<{books:Book[]}>('/api/books')).books;
      const free=catalog.find(book=>!book.id.startsWith('d04-')&&book.availableCopies>0)!;
      await service.requestLoan(free);expect(await repos.outbox.count(a.user.uid)).toBe(1);await service.close();await a.session.clear();
      expect(await repos.outbox.count(a.user.uid)).toBe(0);expect(await repos.loans.list(a.user.uid)).toEqual([]);checks.push('Logout voluntario purga pendientes/privados y SecureStore sustituido');
    } finally {
      network=true;
      if(competitorId)await librarian.api.patch(`/api/loans/${competitorId}`,{action:'return'});
      await db.closeAsync();for(const suffix of ['','-wal','-shm'])if(existsSync(filename+suffix))unlinkSync(filename+suffix);
      if(process.env.E2E_EVIDENCE)writeFileSync(process.env.E2E_EVIDENCE,JSON.stringify({date:'2026-10-21',target:base,scope:'Código móvil+SQLite Node y API reales; red interrumpida en adaptador, no modo avión físico; captura/compresión nativa no ejecutadas',checks,passedControls:checks.length,requests,httpCount:requests.length+1,extraHttp:'1 GET binario de portada contado aparte del transporte JSON',adminInMobile:false},null,2));
    }
  });
});
