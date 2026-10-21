import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { ConnectionBanner } from '@/components/connection-banner';
import { LoanCard } from '@/components/loan-card';
import ProfileScreen from '@/app/(tabs)/profile';
import { makeLoan } from '../test-utils/fakes';
const mockSignOut = jest.fn().mockResolvedValue(undefined);
let mockData: Record<string, unknown>;
jest.mock('@/providers/data-provider',()=>({useData:()=>mockData}));
jest.mock('@/providers/auth-provider',()=>({useAuth:()=>({user:{uid:'u1',name:'Ana',role:'student'}})}));
beforeEach(()=>{
  jest.clearAllMocks();mockSignOut.mockResolvedValue(undefined);
  mockData={networkAvailable:true,online:true,syncing:false,pendingCount:0,attentionCount:0,lastSyncAt:'2026-10-21T12:00:00Z',lastError:null,
    syncNow:jest.fn(),signOut:mockSignOut,retryAttention:jest.fn(),dataVersion:0,
    repos:{activity:{recent:jest.fn().mockResolvedValue([])},outbox:{recent:jest.fn().mockResolvedValue([])}}};
});
describe('estados offline de interfaz con adaptadores React',()=>{
  it('sin red muestra caché y pendientes, sin anunciar sincronización completada',async()=>{
    mockData.networkAvailable=false;mockData.online=false;mockData.pendingCount=2;
    await render(<ConnectionBanner/>);expect(screen.getByText(/Sin conexión.*2 pendiente/)).toBeTruthy();expect(screen.queryByText(/Sincronizado/)).toBeNull();
  });
  it('Wi-Fi disponible con API sin respuesta no se presenta como online verificado',async()=>{
    mockData.online=false;mockData.lastError='La API no respondió';await render(<ConnectionBanner/>);
    expect(screen.getByText(/La API no respondió/)).toBeTruthy();expect(screen.queryByText(/Sincronizado/)).toBeNull();
  });
  it.each(['queued','in_flight'] as const)('solicitud %s no se presenta como préstamo confirmado',async operationState=>{
    await render(<LoanCard loan={{...makeLoan(),syncState:'pending',syncError:null,operationState}} librarian={false} online={false} busy={false} onAction={()=>{}} onDismiss={()=>{}}/>);
    expect(screen.getByText(operationState==='queued'?'Pendiente de envío':'Enviando sin confirmación')).toBeTruthy();expect(screen.queryByText('Prestado')).toBeNull();expect(screen.queryByText('Solicitado')).toBeNull();
  });
  it('salir con pendientes exige confirmación antes de purgar',async()=>{
    mockData.pendingCount=1;const alert=jest.spyOn(Alert,'alert').mockImplementation(()=>{});
    await render(<ProfileScreen/>);await fireEvent.press(screen.getByRole('button',{name:'Cerrar sesión'}));
    expect(mockSignOut).not.toHaveBeenCalled();expect(alert.mock.calls[0][1]).toMatch(/1 solicitud.*sin confirmar/);
    await act(async()=>{ alert.mock.calls[0][2]?.find(b=>b.text==='Cerrar sesión')?.onPress?.(); });
    await waitFor(()=>expect(mockSignOut).toHaveBeenCalledTimes(1));alert.mockRestore();
  });
});
