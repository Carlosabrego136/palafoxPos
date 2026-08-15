import { useEffect } from 'react';
import { useRouter } from 'next/router';

// La raíz solo redirige — o al login, o directo al POS si ya hay sesión
// (el propio /pos revisa la sesión del lado del servidor).
export default function Index() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/pos');
  }, []);
  return null;
}
