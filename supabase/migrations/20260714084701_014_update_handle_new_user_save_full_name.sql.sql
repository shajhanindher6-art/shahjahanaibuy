-- Update handle_new_user to also save full_name from user metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, role_id, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    (SELECT id FROM public.roles WHERE name = 'user' LIMIT 1),
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', '')
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, profiles.full_name, '');
  RETURN NEW;
END;
$function$;
