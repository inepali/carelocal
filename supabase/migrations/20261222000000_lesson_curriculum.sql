-- ============================================================
-- Lesson plan curriculum: Learning Area → Subject → Goal, per center.
--  - Each subject belongs to one learning area and each goal to one subject (composite FKs keep them in
--    the same center). Deleting a parent deletes its children; deactivating keeps past lesson plans intact.
--  - Center admins and owners manage them in /center/lesson-plans; super admins can read them.
--  - public.seed_lesson_curriculum(center) loads the NC Foundations for Early Learning and Development
--    (5 learning areas, 19 subjects, 54 goals) into a center that has none yet. It runs as the caller,
--    so RLS decides who may seed which center.
-- Rollback: supabase/rollbacks/20261222000000_lesson_curriculum.down.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS public.lesson_learning_areas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id   uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  code        text,                                   -- short code, e.g. APL
  name        text NOT NULL,
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lesson_learning_areas_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT lesson_learning_areas_id_center_key UNIQUE (id, center_id)
);

CREATE TABLE IF NOT EXISTS public.lesson_subjects (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id        uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  learning_area_id uuid NOT NULL,
  name             text NOT NULL,
  description      text,
  is_active        boolean NOT NULL DEFAULT true,
  sort_order       integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lesson_subjects_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT lesson_subjects_id_center_key UNIQUE (id, center_id),
  CONSTRAINT lesson_subjects_area_fkey FOREIGN KEY (learning_area_id, center_id)
    REFERENCES public.lesson_learning_areas(id, center_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.lesson_goals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id   uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  subject_id  uuid NOT NULL,
  code        text,                                   -- e.g. APL-1
  name        text NOT NULL,                          -- the goal statement
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lesson_goals_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 500),
  CONSTRAINT lesson_goals_subject_fkey FOREIGN KEY (subject_id, center_id)
    REFERENCES public.lesson_subjects(id, center_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS lesson_learning_areas_center_idx ON public.lesson_learning_areas(center_id, sort_order);
CREATE INDEX IF NOT EXISTS lesson_subjects_area_idx ON public.lesson_subjects(learning_area_id, sort_order);
CREATE INDEX IF NOT EXISTS lesson_subjects_center_idx ON public.lesson_subjects(center_id);
CREATE INDEX IF NOT EXISTS lesson_goals_subject_idx ON public.lesson_goals(subject_id, sort_order);
CREATE INDEX IF NOT EXISTS lesson_goals_center_idx ON public.lesson_goals(center_id);

-- Codes are optional but unique within a center when given
CREATE UNIQUE INDEX IF NOT EXISTS lesson_learning_areas_code_key
  ON public.lesson_learning_areas(center_id, upper(code)) WHERE code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS lesson_goals_code_key
  ON public.lesson_goals(center_id, upper(code)) WHERE code IS NOT NULL;

-- updated_at (touch_updated_at comes from the vendors & inspections migration)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lesson_learning_areas', 'lesson_subjects', 'lesson_goals'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_' || t || '_updated_at', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()',
                   'trg_' || t || '_updated_at', t);
  END LOOP;
END $$;

-- RLS: center admins and owners manage their own center; super admins read
ALTER TABLE public.lesson_learning_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_goals ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lesson_learning_areas', 'lesson_subjects', 'lesson_goals'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Center admins manage ' || t, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL
       USING (center_id IN (SELECT center_id FROM public.center_admins WHERE user_id = auth.uid()))
       WITH CHECK (center_id IN (SELECT center_id FROM public.center_admins WHERE user_id = auth.uid()))',
      'Center admins manage ' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Super admins read ' || t, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT
       USING (((auth.jwt() -> ''app_metadata'' ->> ''is_super_admin'')::boolean = true))',
      'Super admins read ' || t, t);
  END LOOP;
END $$;

-- Starter set: NC Foundations for Early Learning and Development (NC DCDEE / DPI, 2013)
CREATE OR REPLACE FUNCTION public.seed_lesson_curriculum(p_center_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  v_data jsonb := $seed$[
 {
  "code": "APL",
  "name": "Approaches to Play and Learning",
  "subjects": [
   {
    "name": "Curiosity, Information-Seeking, and Eagerness",
    "goals": [
     {
      "code": "APL-1",
      "name": "Children show curiosity and express interest in the world around them."
     },
     {
      "code": "APL-2",
      "name": "Children actively seek to understand the world around them."
     }
    ]
   },
   {
    "name": "Play and Imagination",
    "goals": [
     {
      "code": "APL-3",
      "name": "Children engage in increasingly complex play."
     },
     {
      "code": "APL-4",
      "name": "Children demonstrate creativity, imagination, and inventiveness."
     }
    ]
   },
   {
    "name": "Risk-Taking, Problem-Solving, and Flexibility",
    "goals": [
     {
      "code": "APL-5",
      "name": "Children are willing to try new and challenging experiences."
     },
     {
      "code": "APL-6",
      "name": "Children use a variety of strategies to solve problems."
     }
    ]
   },
   {
    "name": "Attentiveness, Effort, and Persistence",
    "goals": [
     {
      "code": "APL-7",
      "name": "Children demonstrate initiative."
     },
     {
      "code": "APL-8",
      "name": "Children maintain attentiveness and focus."
     },
     {
      "code": "APL-9",
      "name": "Children persist at challenging activities."
     }
    ]
   }
  ]
 },
 {
  "code": "ESD",
  "name": "Emotional and Social Development",
  "subjects": [
   {
    "name": "Developing a Sense of Self",
    "goals": [
     {
      "code": "ESD-1",
      "name": "Children demonstrate a positive sense of self-identity and self-awareness."
     },
     {
      "code": "ESD-2",
      "name": "Children express positive feelings about themselves and confidence in what they can do."
     }
    ]
   },
   {
    "name": "Developing a Sense of Self With Others",
    "goals": [
     {
      "code": "ESD-3",
      "name": "Children form relationships and interact positively with familiar adults who are consistent and responsive to their needs."
     },
     {
      "code": "ESD-4",
      "name": "Children form relationships and interact positively with other children."
     },
     {
      "code": "ESD-5",
      "name": "Children demonstrate the social and behavioral skills needed to successfully participate in groups."
     }
    ]
   },
   {
    "name": "Learning About Feelings",
    "goals": [
     {
      "code": "ESD-6",
      "name": "Children identify, manage, and express their feelings."
     },
     {
      "code": "ESD-7",
      "name": "Children recognize and respond to the needs and feelings of others."
     }
    ]
   }
  ]
 },
 {
  "code": "HPD",
  "name": "Health and Physical Development",
  "subjects": [
   {
    "name": "Physical Health and Growth",
    "goals": [
     {
      "code": "HPD-1",
      "name": "Children develop healthy eating habits."
     },
     {
      "code": "HPD-2",
      "name": "Children engage in active physical play indoors and outdoors."
     },
     {
      "code": "HPD-3",
      "name": "Children develop healthy sleeping habits."
     }
    ]
   },
   {
    "name": "Motor Development",
    "goals": [
     {
      "code": "HPD-4",
      "name": "Children develop the large muscle control and abilities needed to move through and explore their environment."
     },
     {
      "code": "HPD-5",
      "name": "Children develop small muscle control and hand-eye coordination to manipulate objects and work with tools."
     }
    ]
   },
   {
    "name": "Self-Care",
    "goals": [
     {
      "code": "HPD-6",
      "name": "Children develop awareness of their needs and the ability to communicate their needs."
     },
     {
      "code": "HPD-7",
      "name": "Children develop independence in caring for themselves and their environment."
     }
    ]
   },
   {
    "name": "Safety Awareness",
    "goals": [
     {
      "code": "HPD-8",
      "name": "Children develop awareness of basic safety rules and begin to follow them."
     }
    ]
   }
  ]
 },
 {
  "code": "LDC",
  "name": "Language Development and Communication",
  "subjects": [
   {
    "name": "Learning to Communicate",
    "goals": [
     {
      "code": "LDC-1",
      "name": "Children understand communications from others."
     },
     {
      "code": "LDC-2",
      "name": "Children participate in conversations with peers and adults in one-on-one, small, and larger group interactions."
     },
     {
      "code": "LDC-3",
      "name": "Children ask and answer questions in order to seek help, get information, or clarify something that is not understood."
     },
     {
      "code": "LDC-4",
      "name": "Children speak audibly and express thoughts, feelings, and ideas clearly."
     },
     {
      "code": "LDC-5",
      "name": "Children describe familiar people, places, things, and events."
     },
     {
      "code": "LDC-6",
      "name": "Children use most grammatical constructions of their home language well."
     },
     {
      "code": "LDC-7",
      "name": "Children respond to and use a growing vocabulary."
     }
    ]
   },
   {
    "name": "Foundations for Reading",
    "goals": [
     {
      "code": "LDC-8",
      "name": "Children develop interest in books and motivation to read."
     },
     {
      "code": "LDC-9",
      "name": "Children comprehend and use information presented in books and other print media."
     },
     {
      "code": "LDC-10",
      "name": "Children develop book knowledge and print awareness."
     },
     {
      "code": "LDC-11",
      "name": "Children develop phonological awareness."
     },
     {
      "code": "LDC-12",
      "name": "Children develop knowledge of the alphabet and the alphabetic principle."
     }
    ]
   },
   {
    "name": "Foundations for Writing",
    "goals": [
     {
      "code": "LDC-13",
      "name": "Children use writing and other symbols to record information and communicate for a variety of purposes."
     },
     {
      "code": "LDC-14",
      "name": "Children use knowledge of letters in their attempts to write."
     },
     {
      "code": "LDC-15",
      "name": "Children use writing skills and writing conventions."
     }
    ]
   }
  ]
 },
 {
  "code": "CD",
  "name": "Cognitive Development",
  "subjects": [
   {
    "name": "Construction of Knowledge: Thinking and Reasoning",
    "goals": [
     {
      "code": "CD-1",
      "name": "Children use their senses to construct knowledge about the world around them."
     },
     {
      "code": "CD-2",
      "name": "Children recall information and use it for new situations and problems."
     },
     {
      "code": "CD-3",
      "name": "Children demonstrate the ability to think about their own thinking: reasoning, taking perspectives, and making decisions."
     }
    ]
   },
   {
    "name": "Creative Expression",
    "goals": [
     {
      "code": "CD-4",
      "name": "Children demonstrate appreciation for different forms of artistic expression."
     },
     {
      "code": "CD-5",
      "name": "Children demonstrate self-expression and creativity in a variety of forms and contexts, including play, visual arts, music, drama, and dance."
     }
    ]
   },
   {
    "name": "Social Connections",
    "goals": [
     {
      "code": "CD-6",
      "name": "Children demonstrate knowledge of relationships and roles within their own families, homes, classrooms, and communities."
     },
     {
      "code": "CD-7",
      "name": "Children recognize that they are members of different groups (e.g. family, preschool class, cultural group)."
     },
     {
      "code": "CD-8",
      "name": "Children identify and demonstrate acceptance of similarities and differences between themselves and others."
     },
     {
      "code": "CD-9",
      "name": "Children explore concepts connected with their daily experiences in their community."
     }
    ]
   },
   {
    "name": "Mathematical Thinking and Expression",
    "goals": [
     {
      "code": "CD-10",
      "name": "Children show understanding of numbers and quantities during play and other activities."
     },
     {
      "code": "CD-11",
      "name": "Children compare, sort, group, organize, and measure objects and create patterns in their everyday environment."
     },
     {
      "code": "CD-12",
      "name": "Children identify and use common shapes and concepts about position during play and other activities."
     },
     {
      "code": "CD-13",
      "name": "Children use mathematical thinking to solve problems in their everyday environment."
     }
    ]
   },
   {
    "name": "Scientific Exploration and Knowledge",
    "goals": [
     {
      "code": "CD-14",
      "name": "Children observe and describe characteristics of living things and the physical world."
     },
     {
      "code": "CD-15",
      "name": "Children explore the natural world by observing, manipulating objects, asking questions, making predictions, and developing generalizations."
     }
    ]
   }
  ]
 }
]$seed$::jsonb;
  v_area jsonb; v_subject jsonb; v_goal jsonb;
  v_area_id uuid; v_subject_id uuid;
  i int := 0; j int; k int;
  v_goals int := 0;
BEGIN
  -- Serialize seeding per center so a double click can't load it twice
  PERFORM pg_advisory_xact_lock(hashtext('seed_lesson_curriculum:' || p_center_id::text));
  IF EXISTS (SELECT 1 FROM lesson_learning_areas WHERE center_id = p_center_id) THEN
    RAISE EXCEPTION 'This center already has learning areas' USING ERRCODE = 'unique_violation';
  END IF;

  FOR v_area IN SELECT * FROM jsonb_array_elements(v_data) LOOP
    INSERT INTO lesson_learning_areas (center_id, code, name, sort_order)
    VALUES (p_center_id, v_area->>'code', v_area->>'name', i)
    RETURNING id INTO v_area_id;     -- RLS rejects centers the caller doesn't manage
    i := i + 1; j := 0;
    FOR v_subject IN SELECT * FROM jsonb_array_elements(v_area->'subjects') LOOP
      INSERT INTO lesson_subjects (center_id, learning_area_id, name, sort_order)
      VALUES (p_center_id, v_area_id, v_subject->>'name', j)
      RETURNING id INTO v_subject_id;
      j := j + 1; k := 0;
      FOR v_goal IN SELECT * FROM jsonb_array_elements(v_subject->'goals') LOOP
        INSERT INTO lesson_goals (center_id, subject_id, code, name, sort_order)
        VALUES (p_center_id, v_subject_id, v_goal->>'code', v_goal->>'name', k);
        k := k + 1; v_goals := v_goals + 1;
      END LOOP;
    END LOOP;
  END LOOP;
  RETURN v_goals;
END $fn$;

REVOKE ALL ON FUNCTION public.seed_lesson_curriculum(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_lesson_curriculum(uuid) TO authenticated;
