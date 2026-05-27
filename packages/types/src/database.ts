export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      admin_alerts: {
        Row: {
          created_at: string
          id: string
          kind: string
          payload: Json
          resolved_at: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          payload?: Json
          resolved_at?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          payload?: Json
          resolved_at?: string | null
        }
        Relationships: []
      }
      analytics_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          id: number
          payload: Json
          subject_id: string | null
          subject_type: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          id?: never
          payload?: Json
          subject_id?: string | null
          subject_type?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          id?: never
          payload?: Json
          subject_id?: string | null
          subject_type?: string | null
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor: string | null
          at: string
          entity: string
          entity_id: string
          id: number
          new_status: string | null
          old_status: string | null
        }
        Insert: {
          action: string
          actor?: string | null
          at?: string
          entity: string
          entity_id: string
          id?: never
          new_status?: string | null
          old_status?: string | null
        }
        Update: {
          action?: string
          actor?: string | null
          at?: string
          entity?: string
          entity_id?: string
          id?: never
          new_status?: string | null
          old_status?: string | null
        }
        Relationships: []
      }
      blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
          id: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
          id?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "public_profile_card"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "public_profile_card"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      chat_threads: {
        Row: {
          both_ready: boolean
          created_at: string
          id: string
          legal_hold: boolean
          lock_id: string | null
          offer_id: string
          revoked_at: string | null
          state: string
          updated_at: string
        }
        Insert: {
          both_ready?: boolean
          created_at?: string
          id?: string
          legal_hold?: boolean
          lock_id?: string | null
          offer_id: string
          revoked_at?: string | null
          state?: string
          updated_at?: string
        }
        Update: {
          both_ready?: boolean
          created_at?: string
          id?: string
          legal_hold?: boolean
          lock_id?: string | null
          offer_id?: string
          revoked_at?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_threads_lock_id_fkey"
            columns: ["lock_id"]
            isOneToOne: false
            referencedRelation: "locks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_threads_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
        ]
      }
      cities: {
        Row: {
          centroid: unknown
          country: string
          created_at: string
          default_radius_km: number
          id: string
          is_active: boolean
          name: string
          region: string | null
          slug: string
          timezone: string
          updated_at: string
        }
        Insert: {
          centroid?: unknown
          country?: string
          created_at?: string
          default_radius_km?: number
          id?: string
          is_active?: boolean
          name: string
          region?: string | null
          slug: string
          timezone: string
          updated_at?: string
        }
        Update: {
          centroid?: unknown
          country?: string
          created_at?: string
          default_radius_km?: number
          id?: string
          is_active?: boolean
          name?: string
          region?: string | null
          slug?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      date_instances: {
        Row: {
          city_id: string
          created_at: string
          creator_id: string
          duration_min: number
          id: string
          is_seed: boolean
          itinerary_id: string
          moderation_status: Database["public"]["Enums"]["moderation_status"]
          starts_at: string
          status: Database["public"]["Enums"]["date_match_status"]
          time_range: unknown
          updated_at: string
          venue_id: string | null
        }
        Insert: {
          city_id: string
          created_at?: string
          creator_id: string
          duration_min?: number
          id?: string
          is_seed?: boolean
          itinerary_id: string
          moderation_status?: Database["public"]["Enums"]["moderation_status"]
          starts_at: string
          status?: Database["public"]["Enums"]["date_match_status"]
          time_range?: unknown
          updated_at?: string
          venue_id?: string | null
        }
        Update: {
          city_id?: string
          created_at?: string
          creator_id?: string
          duration_min?: number
          id?: string
          is_seed?: boolean
          itinerary_id?: string
          moderation_status?: Database["public"]["Enums"]["moderation_status"]
          starts_at?: string
          status?: Database["public"]["Enums"]["date_match_status"]
          time_range?: unknown
          updated_at?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "date_instances_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "date_instances_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "date_instances_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "public_profile_card"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "date_instances_itinerary_id_fkey"
            columns: ["itinerary_id"]
            isOneToOne: false
            referencedRelation: "itineraries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "date_instances_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          expo_push_token: string | null
          id: string
          last_seen: string
          platform: string | null
          user_id: string
          web_push_sub: Json | null
        }
        Insert: {
          expo_push_token?: string | null
          id?: string
          last_seen?: string
          platform?: string | null
          user_id: string
          web_push_sub?: Json | null
        }
        Update: {
          expo_push_token?: string | null
          id?: string
          last_seen?: string
          platform?: string | null
          user_id?: string
          web_push_sub?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "devices_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devices_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profile_card"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      disputes: {
        Row: {
          created_at: string
          id: string
          kind: string
          lock_id: string
          raised_by: string
          resolution: Json | null
          state: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          lock_id: string
          raised_by: string
          resolution?: Json | null
          state?: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          lock_id?: string
          raised_by?: string
          resolution?: Json | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "disputes_lock_id_fkey"
            columns: ["lock_id"]
            isOneToOne: false
            referencedRelation: "locks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "public_profile_card"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      email_broadcast_sends: {
        Row: {
          broadcast_id: string
          error: string | null
          resend_id: string | null
          sent_at: string
          subscriber_id: string
        }
        Insert: {
          broadcast_id: string
          error?: string | null
          resend_id?: string | null
          sent_at?: string
          subscriber_id: string
        }
        Update: {
          broadcast_id?: string
          error?: string | null
          resend_id?: string | null
          sent_at?: string
          subscriber_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_broadcast_sends_broadcast_id_fkey"
            columns: ["broadcast_id"]
            isOneToOne: false
            referencedRelation: "email_broadcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_broadcast_sends_subscriber_id_fkey"
            columns: ["subscriber_id"]
            isOneToOne: false
            referencedRelation: "subscribers"
            referencedColumns: ["id"]
          },
        ]
      }
      email_broadcasts: {
        Row: {
          body_html: string | null
          body_text: string | null
          id: string
          kind: string
          notes: string | null
          recipient_count: number
          sent_at: string
          subject: string
          triggered_by: string
        }
        Insert: {
          body_html?: string | null
          body_text?: string | null
          id?: string
          kind?: string
          notes?: string | null
          recipient_count?: number
          sent_at?: string
          subject: string
          triggered_by?: string
        }
        Update: {
          body_html?: string | null
          body_text?: string | null
          id?: string
          kind?: string
          notes?: string | null
          recipient_count?: number
          sent_at?: string
          subject?: string
          triggered_by?: string
        }
        Relationships: []
      }
      feature_config: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      feedback: {
        Row: {
          created_at: string
          free_text: string | null
          id: string
          itinerary_id: string
          loved_place_id: string | null
          pacing_rating: string | null
          skipped_place_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          free_text?: string | null
          id?: string
          itinerary_id: string
          loved_place_id?: string | null
          pacing_rating?: string | null
          skipped_place_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          free_text?: string | null
          id?: string
          itinerary_id?: string
          loved_place_id?: string | null
          pacing_rating?: string | null
          skipped_place_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_itinerary_id_fkey"
            columns: ["itinerary_id"]
            isOneToOne: false
            referencedRelation: "itineraries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_loved_place_id_fkey"
            columns: ["loved_place_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_skipped_place_id_fkey"
            columns: ["skipped_place_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
        ]
      }
      insider_applications: {
        Row: {
          best_date_spot: string
          created_at: string
          email: string
          first_name: string
          id: string
          instagram: string | null
          motivation: string
          notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          best_date_spot: string
          created_at?: string
          email: string
          first_name: string
          id?: string
          instagram?: string | null
          motivation: string
          notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          best_date_spot?: string
          created_at?: string
          email?: string
          first_name?: string
          id?: string
          instagram?: string | null
          motivation?: string
          notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "insider_applications_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insider_applications_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "public_profile_card"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      insider_tasks: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          created_at: string
          description: string | null
          id: string
          itinerary_id: string | null
          points_reward: number
          status: string
          submission_notes: string | null
          submission_photo_url: string | null
          submitted_at: string | null
          task_type: string
          title: string
          venue_id: string | null
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          itinerary_id?: string | null
          points_reward?: number
          status?: string
          submission_notes?: string | null
          submission_photo_url?: string | null
          submitted_at?: string | null
          task_type: string
          title: string
          venue_id?: string | null
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          itinerary_id?: string | null
          points_reward?: number
          status?: string
          submission_notes?: string | null
          submission_photo_url?: string | null
          submitted_at?: string | null
          task_type?: string
          title?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "insider_tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insider_tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "public_profile_card"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "insider_tasks_itinerary_id_fkey"
            columns: ["itinerary_id"]
            isOneToOne: false
            referencedRelation: "itineraries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insider_tasks_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
        ]
      }
      itineraries: {
        Row: {
          ambient_sound_url: string | null
          built_by_name: string | null
          built_by_neighborhood: string | null
          city_id: string | null
          claim_email: string | null
          cover_image_generated_at: string | null
          cover_image_prompt: string | null
          cover_image_url: string | null
          generated_at: string
          generation_log: Json | null
          hook: string | null
          id: string
          inputs: Json
          intent: string | null
          is_evergreen: boolean
          is_featured: boolean
          is_public: boolean
          loved_count: number
          match_status: Database["public"]["Enums"]["date_match_status"]
          modifier_id: string | null
          pay_setting: Database["public"]["Enums"]["payment_preference"] | null
          planned_for_date: string | null
          season: string | null
          slug: string | null
          stops: Json
          template_id: string | null
          title: string | null
          total_cost_pp: number | null
          total_duration_min: number | null
          user_id: string | null
          vibe_tags: string[]
          when_planned: string | null
          why_it_works: string | null
          why_note: string | null
        }
        Insert: {
          ambient_sound_url?: string | null
          built_by_name?: string | null
          built_by_neighborhood?: string | null
          city_id?: string | null
          claim_email?: string | null
          cover_image_generated_at?: string | null
          cover_image_prompt?: string | null
          cover_image_url?: string | null
          generated_at?: string
          generation_log?: Json | null
          hook?: string | null
          id?: string
          inputs: Json
          intent?: string | null
          is_evergreen?: boolean
          is_featured?: boolean
          is_public?: boolean
          loved_count?: number
          match_status?: Database["public"]["Enums"]["date_match_status"]
          modifier_id?: string | null
          pay_setting?: Database["public"]["Enums"]["payment_preference"] | null
          planned_for_date?: string | null
          season?: string | null
          slug?: string | null
          stops: Json
          template_id?: string | null
          title?: string | null
          total_cost_pp?: number | null
          total_duration_min?: number | null
          user_id?: string | null
          vibe_tags?: string[]
          when_planned?: string | null
          why_it_works?: string | null
          why_note?: string | null
        }
        Update: {
          ambient_sound_url?: string | null
          built_by_name?: string | null
          built_by_neighborhood?: string | null
          city_id?: string | null
          claim_email?: string | null
          cover_image_generated_at?: string | null
          cover_image_prompt?: string | null
          cover_image_url?: string | null
          generated_at?: string
          generation_log?: Json | null
          hook?: string | null
          id?: string
          inputs?: Json
          intent?: string | null
          is_evergreen?: boolean
          is_featured?: boolean
          is_public?: boolean
          loved_count?: number
          match_status?: Database["public"]["Enums"]["date_match_status"]
          modifier_id?: string | null
          pay_setting?: Database["public"]["Enums"]["payment_preference"] | null
          planned_for_date?: string | null
          season?: string | null
          slug?: string | null
          stops?: Json
          template_id?: string | null
          title?: string | null
          total_cost_pp?: number | null
          total_duration_min?: number | null
          user_id?: string | null
          vibe_tags?: string[]
          when_planned?: string | null
          why_it_works?: string | null
          why_note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "itineraries_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itineraries_modifier_id_fkey"
            columns: ["modifier_id"]
            isOneToOne: false
            referencedRelation: "modifiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itineraries_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "templates"
            referencedColumns: ["id"]
          },
        ]
      }
      itinerary_reviews: {
        Row: {
          confidence: number | null
          created_at: string
          id: string
          issue_tags: string[]
          itinerary_id: string
          notes: string | null
          reviewer_id: string
          reviewer_type: string
          verdict: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          id?: string
          issue_tags?: string[]
          itinerary_id: string
          notes?: string | null
          reviewer_id: string
          reviewer_type: string
          verdict: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          id?: string
          issue_tags?: string[]
          itinerary_id?: string
          notes?: string | null
          reviewer_id?: string
          reviewer_type?: string
          verdict?: string
        }
        Relationships: [
          {
            foreignKeyName: "itinerary_reviews_itinerary_id_fkey"
            columns: ["itinerary_id"]
            isOneToOne: false
            referencedRelation: "itineraries"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          attempts: number
          created_at: string
          dedup_key: string | null
          id: string
          last_error: string | null
          locked_at: string | null
          payload: Json
          run_after: string
          status: Database["public"]["Enums"]["job_status"]
          type: Database["public"]["Enums"]["job_type"]
        }
        Insert: {
          attempts?: number
          created_at?: string
          dedup_key?: string | null
          id?: string
          last_error?: string | null
          locked_at?: string | null
          payload?: Json
          run_after?: string
          status?: Database["public"]["Enums"]["job_status"]
          type: Database["public"]["Enums"]["job_type"]
        }
        Update: {
          attempts?: number
          created_at?: string
          dedup_key?: string | null
          id?: string
          last_error?: string | null
          locked_at?: string | null
          payload?: Json
          run_after?: string
          status?: Database["public"]["Enums"]["job_status"]
          type?: Database["public"]["Enums"]["job_type"]
        }
        Relationships: []
      }
      lock_participants: {
        Row: {
          active: boolean
          lock_id: string
          time_range: unknown
          user_id: string
        }
        Insert: {
          active?: boolean
          lock_id: string
          time_range: unknown
          user_id: string
        }
        Update: {
          active?: boolean
          lock_id?: string
          time_range?: unknown
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lock_participants_lock_id_fkey"
            columns: ["lock_id"]
            isOneToOne: false
            referencedRelation: "locks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lock_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lock_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profile_card"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      locks: {
        Row: {
          cancel_reason: Database["public"]["Enums"]["cancel_reason"] | null
          cancelled_by: string | null
          creator_id: string
          date_instance_id: string
          id: string
          locked_at: string
          matched_user_id: string
          status: Database["public"]["Enums"]["lock_status"]
          updated_at: string
        }
        Insert: {
          cancel_reason?: Database["public"]["Enums"]["cancel_reason"] | null
          cancelled_by?: string | null
          creator_id: string
          date_instance_id: string
          id?: string
          locked_at?: string
          matched_user_id: string
          status?: Database["public"]["Enums"]["lock_status"]
          updated_at?: string
        }
        Update: {
          cancel_reason?: Database["public"]["Enums"]["cancel_reason"] | null
          cancelled_by?: string | null
          creator_id?: string
          date_instance_id?: string
          id?: string
          locked_at?: string
          matched_user_id?: string
          status?: Database["public"]["Enums"]["lock_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "locks_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locks_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "public_profile_card"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "locks_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locks_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "public_profile_card"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "locks_date_instance_id_fkey"
            columns: ["date_instance_id"]
            isOneToOne: true
            referencedRelation: "date_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locks_matched_user_id_fkey"
            columns: ["matched_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locks_matched_user_id_fkey"
            columns: ["matched_user_id"]
            isOneToOne: false
            referencedRelation: "public_profile_card"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      match_ratings: {
        Row: {
          cancelled_with_notice: boolean | null
          id: string
          lock_id: string
          on_time: boolean | null
          ratee_id: string
          rater_id: string
          showed_up: boolean | null
          submitted_at: string
          unsafe_or_disrespectful: boolean | null
        }
        Insert: {
          cancelled_with_notice?: boolean | null
          id?: string
          lock_id: string
          on_time?: boolean | null
          ratee_id: string
          rater_id: string
          showed_up?: boolean | null
          submitted_at?: string
          unsafe_or_disrespectful?: boolean | null
        }
        Update: {
          cancelled_with_notice?: boolean | null
          id?: string
          lock_id?: string
          on_time?: boolean | null
          ratee_id?: string
          rater_id?: string
          showed_up?: boolean | null
          submitted_at?: string
          unsafe_or_disrespectful?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "match_ratings_lock_id_fkey"
            columns: ["lock_id"]
            isOneToOne: false
            referencedRelation: "locks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_ratings_ratee_id_fkey"
            columns: ["ratee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_ratings_ratee_id_fkey"
            columns: ["ratee_id"]
            isOneToOne: false
            referencedRelation: "public_profile_card"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "match_ratings_rater_id_fkey"
            columns: ["rater_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_ratings_rater_id_fkey"
            columns: ["rater_id"]
            isOneToOne: false
            referencedRelation: "public_profile_card"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      modifiers: {
        Row: {
          body: string
          created_at: string
          difficulty: Database["public"]["Enums"]["modifier_difficulty"]
          id: string
          is_active: boolean
          label: string
          occasion_affinity: string[]
          vibe_affinity: string[]
        }
        Insert: {
          body: string
          created_at?: string
          difficulty?: Database["public"]["Enums"]["modifier_difficulty"]
          id: string
          is_active?: boolean
          label: string
          occasion_affinity?: string[]
          vibe_affinity?: string[]
        }
        Update: {
          body?: string
          created_at?: string
          difficulty?: Database["public"]["Enums"]["modifier_difficulty"]
          id?: string
          is_active?: boolean
          label?: string
          occasion_affinity?: string[]
          vibe_affinity?: string[]
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          account_enabled: boolean
          created_at: string
          email_enabled: boolean
          matches_enabled: boolean
          messages_enabled: boolean
          offers_enabled: boolean
          push_enabled: boolean
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          reminders_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          account_enabled?: boolean
          created_at?: string
          email_enabled?: boolean
          matches_enabled?: boolean
          messages_enabled?: boolean
          offers_enabled?: boolean
          push_enabled?: boolean
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          reminders_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          account_enabled?: boolean
          created_at?: string
          email_enabled?: boolean
          matches_enabled?: boolean
          messages_enabled?: boolean
          offers_enabled?: boolean
          push_enabled?: boolean
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          reminders_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "public_profile_card"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      notifications: {
        Row: {
          channel: Database["public"]["Enums"]["notification_channel"] | null
          created_at: string
          dedup_key: string | null
          delivered: boolean
          delivery_error: string | null
          id: string
          payload: Json
          read_at: string | null
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          channel?: Database["public"]["Enums"]["notification_channel"] | null
          created_at?: string
          dedup_key?: string | null
          delivered?: boolean
          delivery_error?: string | null
          id?: string
          payload?: Json
          read_at?: string | null
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["notification_channel"] | null
          created_at?: string
          dedup_key?: string | null
          delivered?: boolean
          delivery_error?: string | null
          id?: string
          payload?: Json
          read_at?: string | null
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profile_card"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      offers: {
        Row: {
          candidate_id: string
          created_at: string
          creator_id: string
          date_instance_id: string
          expires_at: string
          id: string
          resolved_at: string | null
          status: Database["public"]["Enums"]["offer_status"]
        }
        Insert: {
          candidate_id: string
          created_at?: string
          creator_id: string
          date_instance_id: string
          expires_at: string
          id?: string
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["offer_status"]
        }
        Update: {
          candidate_id?: string
          created_at?: string
          creator_id?: string
          date_instance_id?: string
          expires_at?: string
          id?: string
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["offer_status"]
        }
        Relationships: [
          {
            foreignKeyName: "offers_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offers_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "public_profile_card"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "offers_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offers_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "public_profile_card"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "offers_date_instance_id_fkey"
            columns: ["date_instance_id"]
            isOneToOne: false
            referencedRelation: "date_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      pairings: {
        Row: {
          appearances: number
          loved: number
          place_a: string
          place_b: string
          skipped: number
        }
        Insert: {
          appearances?: number
          loved?: number
          place_a: string
          place_b: string
          skipped?: number
        }
        Update: {
          appearances?: number
          loved?: number
          place_a?: string
          place_b?: string
          skipped?: number
        }
        Relationships: [
          {
            foreignKeyName: "pairings_place_a_fkey"
            columns: ["place_a"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pairings_place_b_fkey"
            columns: ["place_b"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
        ]
      }
      place_reviews: {
        Row: {
          action: string
          after_data: Json | null
          before_data: Json | null
          confidence: number | null
          created_at: string
          id: string
          notes: string | null
          place_id: string
          reviewer_id: string
          reviewer_type: string
        }
        Insert: {
          action: string
          after_data?: Json | null
          before_data?: Json | null
          confidence?: number | null
          created_at?: string
          id?: string
          notes?: string | null
          place_id: string
          reviewer_id: string
          reviewer_type: string
        }
        Update: {
          action?: string
          after_data?: Json | null
          before_data?: Json | null
          confidence?: number | null
          created_at?: string
          id?: string
          notes?: string | null
          place_id?: string
          reviewer_id?: string
          reviewer_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "place_reviews_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
        ]
      }
      place_vibe_images: {
        Row: {
          ai_reason: string | null
          ai_score: number | null
          created_at: string
          id: string
          place_id: string
          source: string
          source_query: string | null
          status: string
          url: string
        }
        Insert: {
          ai_reason?: string | null
          ai_score?: number | null
          created_at?: string
          id?: string
          place_id: string
          source?: string
          source_query?: string | null
          status?: string
          url: string
        }
        Update: {
          ai_reason?: string | null
          ai_score?: number | null
          created_at?: string
          id?: string
          place_id?: string
          source?: string
          source_query?: string | null
          status?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "place_vibe_images_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
        ]
      }
      places: {
        Row: {
          address: string | null
          approval_status: Database["public"]["Enums"]["place_approval_status"]
          at_home: boolean
          booking_lead_time_days: number | null
          booking_method: string | null
          booking_phone: string | null
          booking_url: string | null
          category_group: string | null
          closed_days: number[]
          closes: string | null
          created_at: string
          cuisine: string[]
          daytime_photo_url: string | null
          discovered_at: string | null
          drive_cluster: string
          effort: Database["public"]["Enums"]["effort_level"]
          energy: Database["public"]["Enums"]["energy_level"]
          evening_friendly: boolean | null
          evening_photo_url: string | null
          feedback_score: number
          friction_score: string | null
          generated_photo_url: string | null
          google_place_id: string | null
          hours_week: Json | null
          id: string
          is_active: boolean
          is_delighter: boolean
          is_published: boolean
          last_ai_review_at: string | null
          last_ai_review_confidence: number | null
          last_human_review_at: string | null
          last_human_review_by: string | null
          lat: number | null
          llm_summary: string | null
          lng: number | null
          local_insight: string | null
          local_insight_meta: Json | null
          name: string
          neighborhood: string
          notes: string | null
          opens: string | null
          pairing_tags: string[]
          perceived_value: string | null
          phone: string | null
          photo_has_snow: boolean | null
          photo_quality: string | null
          photo_review_notes: string | null
          photo_season: string | null
          photo_time_of_day: string | null
          photo_url: string | null
          photos: Json | null
          price_tier: Database["public"]["Enums"]["price_tier"]
          quality_score: number
          rating: number | null
          reservation_required: boolean
          reservation_url: string | null
          review_count: number | null
          reviews: Json | null
          seasonality: string[]
          slug: string
          source_query: string | null
          time_of_day: string[]
          total_appearances: number
          total_kept: number
          total_loved: number
          total_skipped: number
          type: Database["public"]["Enums"]["place_type"]
          typical_duration_min: number
          typical_per_person: number | null
          updated_at: string
          vibe_tags: string[]
          weather_dependent: boolean
          weather_works_in: Database["public"]["Enums"]["weather_works_in"]
          website: string | null
        }
        Insert: {
          address?: string | null
          approval_status?: Database["public"]["Enums"]["place_approval_status"]
          at_home?: boolean
          booking_lead_time_days?: number | null
          booking_method?: string | null
          booking_phone?: string | null
          booking_url?: string | null
          category_group?: string | null
          closed_days?: number[]
          closes?: string | null
          created_at?: string
          cuisine?: string[]
          daytime_photo_url?: string | null
          discovered_at?: string | null
          drive_cluster: string
          effort?: Database["public"]["Enums"]["effort_level"]
          energy?: Database["public"]["Enums"]["energy_level"]
          evening_friendly?: boolean | null
          evening_photo_url?: string | null
          feedback_score?: number
          friction_score?: string | null
          generated_photo_url?: string | null
          google_place_id?: string | null
          hours_week?: Json | null
          id?: string
          is_active?: boolean
          is_delighter?: boolean
          is_published?: boolean
          last_ai_review_at?: string | null
          last_ai_review_confidence?: number | null
          last_human_review_at?: string | null
          last_human_review_by?: string | null
          lat?: number | null
          llm_summary?: string | null
          lng?: number | null
          local_insight?: string | null
          local_insight_meta?: Json | null
          name: string
          neighborhood: string
          notes?: string | null
          opens?: string | null
          pairing_tags?: string[]
          perceived_value?: string | null
          phone?: string | null
          photo_has_snow?: boolean | null
          photo_quality?: string | null
          photo_review_notes?: string | null
          photo_season?: string | null
          photo_time_of_day?: string | null
          photo_url?: string | null
          photos?: Json | null
          price_tier?: Database["public"]["Enums"]["price_tier"]
          quality_score?: number
          rating?: number | null
          reservation_required?: boolean
          reservation_url?: string | null
          review_count?: number | null
          reviews?: Json | null
          seasonality?: string[]
          slug: string
          source_query?: string | null
          time_of_day?: string[]
          total_appearances?: number
          total_kept?: number
          total_loved?: number
          total_skipped?: number
          type: Database["public"]["Enums"]["place_type"]
          typical_duration_min?: number
          typical_per_person?: number | null
          updated_at?: string
          vibe_tags?: string[]
          weather_dependent?: boolean
          weather_works_in?: Database["public"]["Enums"]["weather_works_in"]
          website?: string | null
        }
        Update: {
          address?: string | null
          approval_status?: Database["public"]["Enums"]["place_approval_status"]
          at_home?: boolean
          booking_lead_time_days?: number | null
          booking_method?: string | null
          booking_phone?: string | null
          booking_url?: string | null
          category_group?: string | null
          closed_days?: number[]
          closes?: string | null
          created_at?: string
          cuisine?: string[]
          daytime_photo_url?: string | null
          discovered_at?: string | null
          drive_cluster?: string
          effort?: Database["public"]["Enums"]["effort_level"]
          energy?: Database["public"]["Enums"]["energy_level"]
          evening_friendly?: boolean | null
          evening_photo_url?: string | null
          feedback_score?: number
          friction_score?: string | null
          generated_photo_url?: string | null
          google_place_id?: string | null
          hours_week?: Json | null
          id?: string
          is_active?: boolean
          is_delighter?: boolean
          is_published?: boolean
          last_ai_review_at?: string | null
          last_ai_review_confidence?: number | null
          last_human_review_at?: string | null
          last_human_review_by?: string | null
          lat?: number | null
          llm_summary?: string | null
          lng?: number | null
          local_insight?: string | null
          local_insight_meta?: Json | null
          name?: string
          neighborhood?: string
          notes?: string | null
          opens?: string | null
          pairing_tags?: string[]
          perceived_value?: string | null
          phone?: string | null
          photo_has_snow?: boolean | null
          photo_quality?: string | null
          photo_review_notes?: string | null
          photo_season?: string | null
          photo_time_of_day?: string | null
          photo_url?: string | null
          photos?: Json | null
          price_tier?: Database["public"]["Enums"]["price_tier"]
          quality_score?: number
          rating?: number | null
          reservation_required?: boolean
          reservation_url?: string | null
          review_count?: number | null
          reviews?: Json | null
          seasonality?: string[]
          slug?: string
          source_query?: string | null
          time_of_day?: string[]
          total_appearances?: number
          total_kept?: number
          total_loved?: number
          total_skipped?: number
          type?: Database["public"]["Enums"]["place_type"]
          typical_duration_min?: number
          typical_per_person?: number | null
          updated_at?: string
          vibe_tags?: string[]
          weather_dependent?: boolean
          weather_works_in?: Database["public"]["Enums"]["weather_works_in"]
          website?: string | null
        }
        Relationships: []
      }
      plan_feedback: {
        Row: {
          created_at: string
          id: string
          itinerary_id: string
          notes: string | null
          skip_stop_idx: number | null
          source: string
          stop_votes: Json | null
          user_agent: string | null
          would_do: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          itinerary_id: string
          notes?: string | null
          skip_stop_idx?: number | null
          source?: string
          stop_votes?: Json | null
          user_agent?: string | null
          would_do?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          itinerary_id?: string
          notes?: string | null
          skip_stop_idx?: number | null
          source?: string
          stop_votes?: Json | null
          user_agent?: string | null
          would_do?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plan_feedback_itinerary_id_fkey"
            columns: ["itinerary_id"]
            isOneToOne: false
            referencedRelation: "itineraries"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_votes: {
        Row: {
          created_at: string
          id: string
          itinerary_id: string
          session_id: string
          voter_name: string | null
          voter_token: string
        }
        Insert: {
          created_at?: string
          id?: string
          itinerary_id: string
          session_id: string
          voter_name?: string | null
          voter_token: string
        }
        Update: {
          created_at?: string
          id?: string
          itinerary_id?: string
          session_id?: string
          voter_name?: string | null
          voter_token?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_votes_itinerary_id_fkey"
            columns: ["itinerary_id"]
            isOneToOne: false
            referencedRelation: "itineraries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_votes_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vote_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_prompts: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          label: string
          placeholder: string | null
          sort_order: number
        }
        Insert: {
          created_at?: string
          id: string
          is_active?: boolean
          label: string
          placeholder?: string | null
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string
          placeholder?: string | null
          sort_order?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          account_state: Database["public"]["Enums"]["account_lifecycle"]
          age: number | null
          age_pref: unknown
          blurred_photo_url: string | null
          city: string | null
          clear_photo_url: string | null
          created_at: string
          dating_enabled: boolean
          dealbreakers: string[]
          distance_pref_km: number
          email: string | null
          first_name: string | null
          gender: string | null
          gender_preferences: string[]
          id: string
          insider_approved_at: string | null
          insider_points: number
          insider_role: string | null
          neighborhood: string | null
          onboarding_completed_at: string | null
          onboarding_step: string
          primary_city_id: string | null
          prompt_answers: Json
          reliability_score: number | null
          rollover_frozen: boolean
          standing: Database["public"]["Enums"]["standing_state"]
          updated_at: string
          verification: Database["public"]["Enums"]["verification_state"]
          vibe_tags: string[]
        }
        Insert: {
          account_state?: Database["public"]["Enums"]["account_lifecycle"]
          age?: number | null
          age_pref?: unknown
          blurred_photo_url?: string | null
          city?: string | null
          clear_photo_url?: string | null
          created_at?: string
          dating_enabled?: boolean
          dealbreakers?: string[]
          distance_pref_km?: number
          email?: string | null
          first_name?: string | null
          gender?: string | null
          gender_preferences?: string[]
          id: string
          insider_approved_at?: string | null
          insider_points?: number
          insider_role?: string | null
          neighborhood?: string | null
          onboarding_completed_at?: string | null
          onboarding_step?: string
          primary_city_id?: string | null
          prompt_answers?: Json
          reliability_score?: number | null
          rollover_frozen?: boolean
          standing?: Database["public"]["Enums"]["standing_state"]
          updated_at?: string
          verification?: Database["public"]["Enums"]["verification_state"]
          vibe_tags?: string[]
        }
        Update: {
          account_state?: Database["public"]["Enums"]["account_lifecycle"]
          age?: number | null
          age_pref?: unknown
          blurred_photo_url?: string | null
          city?: string | null
          clear_photo_url?: string | null
          created_at?: string
          dating_enabled?: boolean
          dealbreakers?: string[]
          distance_pref_km?: number
          email?: string | null
          first_name?: string | null
          gender?: string | null
          gender_preferences?: string[]
          id?: string
          insider_approved_at?: string | null
          insider_points?: number
          insider_role?: string | null
          neighborhood?: string | null
          onboarding_completed_at?: string | null
          onboarding_step?: string
          primary_city_id?: string | null
          prompt_answers?: Json
          reliability_score?: number | null
          rollover_frozen?: boolean
          standing?: Database["public"]["Enums"]["standing_state"]
          updated_at?: string
          verification?: Database["public"]["Enums"]["verification_state"]
          vibe_tags?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "profiles_primary_city_id_fkey"
            columns: ["primary_city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles_private: {
        Row: {
          bio: string | null
          birthdate: string | null
          created_at: string
          emergency_contact: Json | null
          full_name: string | null
          instagram_handle: string | null
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          bio?: string | null
          birthdate?: string | null
          created_at?: string
          emergency_contact?: Json | null
          full_name?: string | null
          instagram_handle?: string | null
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          bio?: string | null
          birthdate?: string | null
          created_at?: string
          emergency_contact?: Json | null
          full_name?: string | null
          instagram_handle?: string | null
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_private_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_private_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "public_profile_card"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      queue_entries: {
        Row: {
          candidate_id: string
          created_at: string
          creator_id: string
          date_instance_id: string
          id: string
          rank: number | null
          status: Database["public"]["Enums"]["queue_status"]
          updated_at: string
        }
        Insert: {
          candidate_id: string
          created_at?: string
          creator_id: string
          date_instance_id: string
          id?: string
          rank?: number | null
          status?: Database["public"]["Enums"]["queue_status"]
          updated_at?: string
        }
        Update: {
          candidate_id?: string
          created_at?: string
          creator_id?: string
          date_instance_id?: string
          id?: string
          rank?: number | null
          status?: Database["public"]["Enums"]["queue_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "queue_entries_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "queue_entries_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "public_profile_card"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "queue_entries_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "queue_entries_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "public_profile_card"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "queue_entries_date_instance_id_fkey"
            columns: ["date_instance_id"]
            isOneToOne: false
            referencedRelation: "date_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          created_at: string
          endpoint: string
          id: number
          identifier: string
          request_count: number
          window_start: string
        }
        Insert: {
          created_at?: string
          endpoint: string
          id?: never
          identifier: string
          request_count?: number
          window_start: string
        }
        Update: {
          created_at?: string
          endpoint?: string
          id?: never
          identifier?: string
          request_count?: number
          window_start?: string
        }
        Relationships: []
      }
      reports: {
        Row: {
          created_at: string
          detail: string | null
          id: string
          pay_setting_snapshot: Json | null
          reason_category: Database["public"]["Enums"]["report_reason_category"]
          reporter_id: string | null
          resolution_code: string | null
          status: Database["public"]["Enums"]["report_status"]
          target_id: string
          target_type: string
        }
        Insert: {
          created_at?: string
          detail?: string | null
          id?: string
          pay_setting_snapshot?: Json | null
          reason_category: Database["public"]["Enums"]["report_reason_category"]
          reporter_id?: string | null
          resolution_code?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          target_id: string
          target_type: string
        }
        Update: {
          created_at?: string
          detail?: string | null
          id?: string
          pay_setting_snapshot?: Json | null
          reason_category?: Database["public"]["Enums"]["report_reason_category"]
          reporter_id?: string | null
          resolution_code?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "public_profile_card"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      saved_plans: {
        Row: {
          feedback_completed_at: string | null
          feedback_email_sent_at: string | null
          id: string
          itinerary_id: string
          note: string | null
          saved_at: string
          user_id: string
        }
        Insert: {
          feedback_completed_at?: string | null
          feedback_email_sent_at?: string | null
          id?: string
          itinerary_id: string
          note?: string | null
          saved_at?: string
          user_id: string
        }
        Update: {
          feedback_completed_at?: string | null
          feedback_email_sent_at?: string | null
          id?: string
          itinerary_id?: string
          note?: string | null
          saved_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_plans_itinerary_id_fkey"
            columns: ["itinerary_id"]
            isOneToOne: false
            referencedRelation: "itineraries"
            referencedColumns: ["id"]
          },
        ]
      }
      spatial_ref_sys: {
        Row: {
          auth_name: string | null
          auth_srid: number | null
          proj4text: string | null
          srid: number
          srtext: string | null
        }
        Insert: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid: number
          srtext?: string | null
        }
        Update: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid?: number
          srtext?: string | null
        }
        Relationships: []
      }
      subscribers: {
        Row: {
          city: string | null
          created_at: string
          email: string
          email_opt_out: boolean
          first_name: string | null
          id: string
          itinerary_id: string | null
          location: string | null
          opted_out_at: string | null
          source: string
          user_agent: string | null
          welcome_sent_at: string | null
        }
        Insert: {
          city?: string | null
          created_at?: string
          email: string
          email_opt_out?: boolean
          first_name?: string | null
          id?: string
          itinerary_id?: string | null
          location?: string | null
          opted_out_at?: string | null
          source?: string
          user_agent?: string | null
          welcome_sent_at?: string | null
        }
        Update: {
          city?: string | null
          created_at?: string
          email?: string
          email_opt_out?: boolean
          first_name?: string | null
          id?: string
          itinerary_id?: string | null
          location?: string | null
          opted_out_at?: string | null
          source?: string
          user_agent?: string | null
          welcome_sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscribers_itinerary_id_fkey"
            columns: ["itinerary_id"]
            isOneToOne: false
            referencedRelation: "itineraries"
            referencedColumns: ["id"]
          },
        ]
      }
      swipes: {
        Row: {
          created_at: string
          creator_id: string
          date_instance_id: string
          direction: Database["public"]["Enums"]["swipe_direction"]
          id: string
          swiper_id: string
        }
        Insert: {
          created_at?: string
          creator_id: string
          date_instance_id: string
          direction: Database["public"]["Enums"]["swipe_direction"]
          id?: string
          swiper_id: string
        }
        Update: {
          created_at?: string
          creator_id?: string
          date_instance_id?: string
          direction?: Database["public"]["Enums"]["swipe_direction"]
          id?: string
          swiper_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "swipes_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swipes_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "public_profile_card"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "swipes_date_instance_id_fkey"
            columns: ["date_instance_id"]
            isOneToOne: false
            referencedRelation: "date_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swipes_swiper_id_fkey"
            columns: ["swiper_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swipes_swiper_id_fkey"
            columns: ["swiper_id"]
            isOneToOne: false
            referencedRelation: "public_profile_card"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      templates: {
        Row: {
          created_at: string
          duration_min: number
          energy_curve: string | null
          geographic_rule: string | null
          id: string
          is_active: boolean
          name: string
          selection_weight: number
          slots: Json
          suitable_for: Database["public"]["Enums"]["occasion"][]
          vibe: string[]
        }
        Insert: {
          created_at?: string
          duration_min: number
          energy_curve?: string | null
          geographic_rule?: string | null
          id: string
          is_active?: boolean
          name: string
          selection_weight?: number
          slots: Json
          suitable_for: Database["public"]["Enums"]["occasion"][]
          vibe?: string[]
        }
        Update: {
          created_at?: string
          duration_min?: number
          energy_curve?: string | null
          geographic_rule?: string | null
          id?: string
          is_active?: boolean
          name?: string
          selection_weight?: number
          slots?: Json
          suitable_for?: Database["public"]["Enums"]["occasion"][]
          vibe?: string[]
        }
        Relationships: []
      }
      user_feedback: {
        Row: {
          body: string
          created_at: string
          email: string | null
          id: string
          kind: string
          page_url: string | null
          status: string
          subject: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          body: string
          created_at?: string
          email?: string | null
          id?: string
          kind: string
          page_url?: string | null
          status?: string
          subject?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          email?: string | null
          id?: string
          kind?: string
          page_url?: string | null
          status?: string
          subject?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          cluster_weights: Json
          drive_tolerance_min: number | null
          price_tier_actual: Database["public"]["Enums"]["price_tier"] | null
          type_weights: Json
          updated_at: string
          user_id: string
          vibe_weights: Json
        }
        Insert: {
          cluster_weights?: Json
          drive_tolerance_min?: number | null
          price_tier_actual?: Database["public"]["Enums"]["price_tier"] | null
          type_weights?: Json
          updated_at?: string
          user_id: string
          vibe_weights?: Json
        }
        Update: {
          cluster_weights?: Json
          drive_tolerance_min?: number | null
          price_tier_actual?: Database["public"]["Enums"]["price_tier"] | null
          type_weights?: Json
          updated_at?: string
          user_id?: string
          vibe_weights?: Json
        }
        Relationships: []
      }
      verifications: {
        Row: {
          created_at: string
          failure_reason: string | null
          id: string
          kind: string
          provider: string | null
          provider_ref: string | null
          state: Database["public"]["Enums"]["verification_state"]
          updated_at: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          failure_reason?: string | null
          id?: string
          kind: string
          provider?: string | null
          provider_ref?: string | null
          state?: Database["public"]["Enums"]["verification_state"]
          updated_at?: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          failure_reason?: string | null
          id?: string
          kind?: string
          provider?: string | null
          provider_ref?: string | null
          state?: Database["public"]["Enums"]["verification_state"]
          updated_at?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "verifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profile_card"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      vote_sessions: {
        Row: {
          created_at: string
          created_by_email: string | null
          id: string
          itinerary_ids: string[]
        }
        Insert: {
          created_at?: string
          created_by_email?: string | null
          id?: string
          itinerary_ids: string[]
        }
        Update: {
          created_at?: string
          created_by_email?: string | null
          id?: string
          itinerary_ids?: string[]
        }
        Relationships: []
      }
    }
    Views: {
      geography_columns: {
        Row: {
          coord_dimension: number | null
          f_geography_column: unknown
          f_table_catalog: unknown
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Relationships: []
      }
      geometry_columns: {
        Row: {
          coord_dimension: number | null
          f_geometry_column: unknown
          f_table_catalog: string | null
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Insert: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Update: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Relationships: []
      }
      public_profile_card: {
        Row: {
          age: number | null
          badge_is_new: boolean | null
          badge_verified: boolean | null
          blurred_photo_url: string | null
          profile_id: string | null
          prompt_answers: Json | null
          reliability_score: number | null
          vibe_tags: string[] | null
        }
        Insert: {
          age?: number | null
          badge_is_new?: never
          badge_verified?: never
          blurred_photo_url?: string | null
          profile_id?: string | null
          prompt_answers?: Json | null
          reliability_score?: number | null
          vibe_tags?: string[] | null
        }
        Update: {
          age?: number | null
          badge_is_new?: never
          badge_verified?: never
          blurred_photo_url?: string | null
          profile_id?: string | null
          prompt_answers?: Json | null
          reliability_score?: number | null
          vibe_tags?: string[] | null
        }
        Relationships: []
      }
    }
    Functions: {
      _postgis_deprecate: {
        Args: { newname: string; oldname: string; version: string }
        Returns: undefined
      }
      _postgis_index_extent: {
        Args: { col: string; tbl: unknown }
        Returns: unknown
      }
      _postgis_pgsql_version: { Args: never; Returns: string }
      _postgis_scripts_pgsql_version: { Args: never; Returns: string }
      _postgis_selectivity: {
        Args: { att_name: string; geom: unknown; mode?: string; tbl: unknown }
        Returns: number
      }
      _postgis_stats: {
        Args: { ""?: string; att_name: string; tbl: unknown }
        Returns: string
      }
      _st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_crosses: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      _st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_intersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      _st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      _st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      _st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_sortablehash: { Args: { geom: unknown }; Returns: number }
      _st_touches: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_voronoi: {
        Args: {
          clip?: unknown
          g1: unknown
          return_polygons?: boolean
          tolerance?: number
        }
        Returns: unknown
      }
      _st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      addauth: { Args: { "": string }; Returns: boolean }
      addgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              new_dim: number
              new_srid_in: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
      advance_onboarding_step: { Args: { p_to_step: string }; Returns: string }
      browse_feed_for_viewer: {
        Args: {
          p_after_id?: string
          p_after_starts?: string
          p_limit?: number
          p_point?: unknown
          p_viewer?: string
        }
        Returns: {
          city_id: string
          cover_image_url: string
          date_instance_id: string
          distance_m: number
          is_seed: boolean
          itinerary_id: string
          pay_setting: string
          time_window_start: string
          title: string
          venue_neighborhood: string
          vibe_tags: string[]
          why_note: string
        }[]
      }
      can_enter_lock_flow: { Args: { p_user: string }; Returns: boolean }
      cancel_jobs: {
        Args: {
          p_dedup_key: string
          p_type: Database["public"]["Enums"]["job_type"]
        }
        Returns: number
      }
      chat_lock_ready: { Args: { p_thread: string }; Returns: boolean }
      claim_due_jobs: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          created_at: string
          dedup_key: string | null
          id: string
          last_error: string | null
          locked_at: string | null
          payload: Json
          run_after: string
          status: Database["public"]["Enums"]["job_status"]
          type: Database["public"]["Enums"]["job_type"]
        }[]
        SetofOptions: {
          from: "*"
          to: "jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      close_chat_thread: { Args: { p_offer: string }; Returns: undefined }
      complete_job: { Args: { p_id: string }; Returns: undefined }
      disablelongtransactions: { Args: never; Returns: string }
      dispatch_notification: {
        Args: {
          p_payload?: Json
          p_type: Database["public"]["Enums"]["notification_type"]
          p_user: string
        }
        Returns: Json
      }
      dropgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { column_name: string; table_name: string }; Returns: string }
      dropgeometrytable:
        | {
            Args: {
              catalog_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { schema_name: string; table_name: string }; Returns: string }
        | { Args: { table_name: string }; Returns: string }
      emit_analytics: {
        Args: {
          p_actor_id: string
          p_event_type: string
          p_payload?: Json
          p_subject_id?: string
          p_subject_type?: string
        }
        Returns: number
      }
      enablelongtransactions: { Args: never; Returns: string }
      enqueue_job: {
        Args: {
          p_dedup_key?: string
          p_payload?: Json
          p_run_after: string
          p_type: Database["public"]["Enums"]["job_type"]
        }
        Returns: string
      }
      equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      fail_job: { Args: { p_error: string; p_id: string }; Returns: undefined }
      geometry: { Args: { "": string }; Returns: unknown }
      geometry_above: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_below: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_cmp: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_contained_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_distance_box: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_distance_centroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_eq: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_ge: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_gt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_le: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_left: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_lt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overabove: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overbelow: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overleft: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overright: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_right: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_within: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geomfromewkt: { Args: { "": string }; Returns: unknown }
      gettransactionid: { Args: never; Returns: unknown }
      longtransactionsenabled: { Args: never; Returns: boolean }
      mark_notification_delivered: {
        Args: { p_error?: string; p_id: string }
        Returns: undefined
      }
      mk_instance: {
        Args: { p_creator: string; p_itin: string; p_starts: string }
        Returns: string
      }
      mk_itinerary: { Args: { p_user: string }; Returns: string }
      mk_user: { Args: { p_label: string }; Returns: string }
      notification_rate_check: {
        Args: {
          p_type: Database["public"]["Enums"]["notification_type"]
          p_user_id: string
        }
        Returns: Json
      }
      offer_expires_at: { Args: { p_from?: string }; Returns: string }
      open_chat_thread: { Args: { p_offer: string }; Returns: string }
      populate_geometry_columns:
        | { Args: { tbl_oid: unknown; use_typmod?: boolean }; Returns: number }
        | { Args: { use_typmod?: boolean }; Returns: string }
      post_night: {
        Args: {
          p_duration_min?: number
          p_itinerary: string
          p_starts_at: string
          p_venue?: string
        }
        Returns: string
      }
      postgis_constraint_dims: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_srid: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_type: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: string
      }
      postgis_extensions_upgrade: { Args: never; Returns: string }
      postgis_full_version: { Args: never; Returns: string }
      postgis_geos_version: { Args: never; Returns: string }
      postgis_lib_build_date: { Args: never; Returns: string }
      postgis_lib_revision: { Args: never; Returns: string }
      postgis_lib_version: { Args: never; Returns: string }
      postgis_libjson_version: { Args: never; Returns: string }
      postgis_liblwgeom_version: { Args: never; Returns: string }
      postgis_libprotobuf_version: { Args: never; Returns: string }
      postgis_libxml_version: { Args: never; Returns: string }
      postgis_proj_version: { Args: never; Returns: string }
      postgis_scripts_build_date: { Args: never; Returns: string }
      postgis_scripts_installed: { Args: never; Returns: string }
      postgis_scripts_released: { Args: never; Returns: string }
      postgis_svn_version: { Args: never; Returns: string }
      postgis_type_name: {
        Args: {
          coord_dimension: number
          geomname: string
          use_new_name?: boolean
        }
        Returns: string
      }
      postgis_version: { Args: never; Returns: string }
      postgis_wagyu_version: { Args: never; Returns: string }
      promote_chat_thread_to_lock: {
        Args: { p_lock: string; p_offer: string }
        Returns: undefined
      }
      raise_admin_alert: {
        Args: { p_kind: string; p_payload?: Json }
        Returns: string
      }
      rate_limit_check: {
        Args: {
          p_endpoint: string
          p_identifier: string
          p_max_requests: number
        }
        Returns: Json
      }
      recompute_profile_verification: {
        Args: { p_user: string }
        Returns: undefined
      }
      record_swipe: {
        Args: {
          p_direction: Database["public"]["Enums"]["swipe_direction"]
          p_instance: string
        }
        Returns: undefined
      }
      register_device: {
        Args: { p_platform: string; p_token: string; p_web_push?: Json }
        Returns: string
      }
      requeue_stuck_jobs: { Args: { p_grace?: string }; Returns: number }
      st_3dclosestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3ddistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_3dlongestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmakebox: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmaxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dshortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_addpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_angle:
        | { Args: { line1: unknown; line2: unknown }; Returns: number }
        | {
            Args: { pt1: unknown; pt2: unknown; pt3: unknown; pt4?: unknown }
            Returns: number
          }
      st_area:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_asencodedpolyline: {
        Args: { geom: unknown; nprecision?: number }
        Returns: string
      }
      st_asewkt: { Args: { "": string }; Returns: string }
      st_asgeojson:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: {
              geom_column?: string
              maxdecimaldigits?: number
              pretty_bool?: boolean
              r: Record<string, unknown>
            }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_asgml:
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
            }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
      st_askml:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_aslatlontext: {
        Args: { geom: unknown; tmpl?: string }
        Returns: string
      }
      st_asmarc21: { Args: { format?: string; geom: unknown }; Returns: string }
      st_asmvtgeom: {
        Args: {
          bounds: unknown
          buffer?: number
          clip_geom?: boolean
          extent?: number
          geom: unknown
        }
        Returns: unknown
      }
      st_assvg:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_astext: { Args: { "": string }; Returns: string }
      st_astwkb:
        | {
            Args: {
              geom: unknown
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown[]
              ids: number[]
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
      st_asx3d: {
        Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
        Returns: string
      }
      st_azimuth:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: number }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_boundingdiagonal: {
        Args: { fits?: boolean; geom: unknown }
        Returns: unknown
      }
      st_buffer:
        | {
            Args: { geom: unknown; options?: string; radius: number }
            Returns: unknown
          }
        | {
            Args: { geom: unknown; quadsegs: number; radius: number }
            Returns: unknown
          }
      st_centroid: { Args: { "": string }; Returns: unknown }
      st_clipbybox2d: {
        Args: { box: unknown; geom: unknown }
        Returns: unknown
      }
      st_closestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_collect: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_concavehull: {
        Args: {
          param_allow_holes?: boolean
          param_geom: unknown
          param_pctconvex: number
        }
        Returns: unknown
      }
      st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_coorddim: { Args: { geometry: unknown }; Returns: number }
      st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_crosses: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_curvetoline: {
        Args: { flags?: number; geom: unknown; tol?: number; toltype?: number }
        Returns: unknown
      }
      st_delaunaytriangles: {
        Args: { flags?: number; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_difference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_disjoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_distance:
        | {
            Args: { geog1: unknown; geog2: unknown; use_spheroid?: boolean }
            Returns: number
          }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_distancesphere:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
        | {
            Args: { geom1: unknown; geom2: unknown; radius: number }
            Returns: number
          }
      st_distancespheroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_expand:
        | { Args: { box: unknown; dx: number; dy: number }; Returns: unknown }
        | {
            Args: { box: unknown; dx: number; dy: number; dz?: number }
            Returns: unknown
          }
        | {
            Args: {
              dm?: number
              dx: number
              dy: number
              dz?: number
              geom: unknown
            }
            Returns: unknown
          }
      st_force3d: { Args: { geom: unknown; zvalue?: number }; Returns: unknown }
      st_force3dm: {
        Args: { geom: unknown; mvalue?: number }
        Returns: unknown
      }
      st_force3dz: {
        Args: { geom: unknown; zvalue?: number }
        Returns: unknown
      }
      st_force4d: {
        Args: { geom: unknown; mvalue?: number; zvalue?: number }
        Returns: unknown
      }
      st_generatepoints:
        | { Args: { area: unknown; npoints: number }; Returns: unknown }
        | {
            Args: { area: unknown; npoints: number; seed: number }
            Returns: unknown
          }
      st_geogfromtext: { Args: { "": string }; Returns: unknown }
      st_geographyfromtext: { Args: { "": string }; Returns: unknown }
      st_geohash:
        | { Args: { geog: unknown; maxchars?: number }; Returns: string }
        | { Args: { geom: unknown; maxchars?: number }; Returns: string }
      st_geomcollfromtext: { Args: { "": string }; Returns: unknown }
      st_geometricmedian: {
        Args: {
          fail_if_not_converged?: boolean
          g: unknown
          max_iter?: number
          tolerance?: number
        }
        Returns: unknown
      }
      st_geometryfromtext: { Args: { "": string }; Returns: unknown }
      st_geomfromewkt: { Args: { "": string }; Returns: unknown }
      st_geomfromgeojson:
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": string }; Returns: unknown }
      st_geomfromgml: { Args: { "": string }; Returns: unknown }
      st_geomfromkml: { Args: { "": string }; Returns: unknown }
      st_geomfrommarc21: { Args: { marc21xml: string }; Returns: unknown }
      st_geomfromtext: { Args: { "": string }; Returns: unknown }
      st_gmltosql: { Args: { "": string }; Returns: unknown }
      st_hasarc: { Args: { geometry: unknown }; Returns: boolean }
      st_hausdorffdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_hexagon: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_hexagongrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_interpolatepoint: {
        Args: { line: unknown; point: unknown }
        Returns: number
      }
      st_intersection: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_intersects:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_isvaliddetail: {
        Args: { flags?: number; geom: unknown }
        Returns: Database["public"]["CompositeTypes"]["valid_detail"]
        SetofOptions: {
          from: "*"
          to: "valid_detail"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      st_length:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_letters: { Args: { font?: Json; letters: string }; Returns: unknown }
      st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      st_linefromencodedpolyline: {
        Args: { nprecision?: number; txtin: string }
        Returns: unknown
      }
      st_linefromtext: { Args: { "": string }; Returns: unknown }
      st_linelocatepoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_linetocurve: { Args: { geometry: unknown }; Returns: unknown }
      st_locatealong: {
        Args: { geometry: unknown; leftrightoffset?: number; measure: number }
        Returns: unknown
      }
      st_locatebetween: {
        Args: {
          frommeasure: number
          geometry: unknown
          leftrightoffset?: number
          tomeasure: number
        }
        Returns: unknown
      }
      st_locatebetweenelevations: {
        Args: { fromelevation: number; geometry: unknown; toelevation: number }
        Returns: unknown
      }
      st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makebox2d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makeline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makevalid: {
        Args: { geom: unknown; params: string }
        Returns: unknown
      }
      st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_minimumboundingcircle: {
        Args: { inputgeom: unknown; segs_per_quarter?: number }
        Returns: unknown
      }
      st_mlinefromtext: { Args: { "": string }; Returns: unknown }
      st_mpointfromtext: { Args: { "": string }; Returns: unknown }
      st_mpolyfromtext: { Args: { "": string }; Returns: unknown }
      st_multilinestringfromtext: { Args: { "": string }; Returns: unknown }
      st_multipointfromtext: { Args: { "": string }; Returns: unknown }
      st_multipolygonfromtext: { Args: { "": string }; Returns: unknown }
      st_node: { Args: { g: unknown }; Returns: unknown }
      st_normalize: { Args: { geom: unknown }; Returns: unknown }
      st_offsetcurve: {
        Args: { distance: number; line: unknown; params?: string }
        Returns: unknown
      }
      st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_perimeter: {
        Args: { geog: unknown; use_spheroid?: boolean }
        Returns: number
      }
      st_pointfromtext: { Args: { "": string }; Returns: unknown }
      st_pointm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
        }
        Returns: unknown
      }
      st_pointz: {
        Args: {
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_pointzm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_polyfromtext: { Args: { "": string }; Returns: unknown }
      st_polygonfromtext: { Args: { "": string }; Returns: unknown }
      st_project: {
        Args: { azimuth: number; distance: number; geog: unknown }
        Returns: unknown
      }
      st_quantizecoordinates: {
        Args: {
          g: unknown
          prec_m?: number
          prec_x: number
          prec_y?: number
          prec_z?: number
        }
        Returns: unknown
      }
      st_reduceprecision: {
        Args: { geom: unknown; gridsize: number }
        Returns: unknown
      }
      st_relate: { Args: { geom1: unknown; geom2: unknown }; Returns: string }
      st_removerepeatedpoints: {
        Args: { geom: unknown; tolerance?: number }
        Returns: unknown
      }
      st_segmentize: {
        Args: { geog: unknown; max_segment_length: number }
        Returns: unknown
      }
      st_setsrid:
        | { Args: { geog: unknown; srid: number }; Returns: unknown }
        | { Args: { geom: unknown; srid: number }; Returns: unknown }
      st_sharedpaths: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_shortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_simplifypolygonhull: {
        Args: { geom: unknown; is_outer?: boolean; vertex_fraction: number }
        Returns: unknown
      }
      st_split: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_square: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_squaregrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_srid:
        | { Args: { geog: unknown }; Returns: number }
        | { Args: { geom: unknown }; Returns: number }
      st_subdivide: {
        Args: { geom: unknown; gridsize?: number; maxvertices?: number }
        Returns: unknown[]
      }
      st_swapordinates: {
        Args: { geom: unknown; ords: unknown }
        Returns: unknown
      }
      st_symdifference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_symmetricdifference: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_tileenvelope: {
        Args: {
          bounds?: unknown
          margin?: number
          x: number
          y: number
          zoom: number
        }
        Returns: unknown
      }
      st_touches: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_transform:
        | {
            Args: { from_proj: string; geom: unknown; to_proj: string }
            Returns: unknown
          }
        | {
            Args: { from_proj: string; geom: unknown; to_srid: number }
            Returns: unknown
          }
        | { Args: { geom: unknown; to_proj: string }; Returns: unknown }
      st_triangulatepolygon: { Args: { g1: unknown }; Returns: unknown }
      st_union:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
        | {
            Args: { geom1: unknown; geom2: unknown; gridsize: number }
            Returns: unknown
          }
      st_voronoilines: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_voronoipolygons: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_wkbtosql: { Args: { wkb: string }; Returns: unknown }
      st_wkttosql: { Args: { "": string }; Returns: unknown }
      st_wrapx: {
        Args: { geom: unknown; move: number; wrap: number }
        Returns: unknown
      }
      tstzrange_from_start_duration: {
        Args: { p_mins: number; p_start: string }
        Returns: unknown
      }
      unlockrows: { Args: { "": string }; Returns: number }
      updategeometrysrid: {
        Args: {
          catalogn_name: string
          column_name: string
          new_srid_in: number
          schema_name: string
          table_name: string
        }
        Returns: string
      }
    }
    Enums: {
      account_lifecycle: "active" | "paused" | "deletion_pending" | "deleted"
      cancel_reason:
        | "schedule_conflict"
        | "venue_issue"
        | "changed_mind"
        | "account_closed"
        | "safety"
        | "misconduct"
        | "other"
      date_match_status:
        | "none"
        | "seeking"
        | "matched"
        | "completed"
        | "cancelled"
      effort_level: "low" | "moderate" | "high"
      energy_level: "low" | "medium" | "high"
      job_status: "pending" | "running" | "done" | "failed" | "cancelled"
      job_type:
        | "offer_expiry"
        | "standby_roll"
        | "pending_expiry"
        | "stale_date_close"
        | "day_of_reconfirm"
        | "safety_checkin"
        | "reconfirm_timeout"
        | "bulk_withdraw"
        | "chat_purge"
        | "rating_window"
        | "deletion_process"
        | "analytics_relay"
        | "notify"
      lock_status: "active" | "completed" | "cancelled" | "no_show"
      moderation_status: "pending" | "approved" | "rejected"
      modifier_difficulty: "tame" | "spicy" | "chaos"
      notification_channel:
        | "push_ios"
        | "push_android"
        | "web_push"
        | "email"
        | "admin_alert"
        | "suppressed"
      notification_type:
        | "new_match"
        | "offer_received"
        | "offer_expiring"
        | "standby_promoted"
        | "date_reconfirm"
        | "safety_checkin"
        | "safety_alert"
        | "new_message"
        | "rating_request"
        | "moderation_action"
        | "account"
        | "verification_passed"
        | "verification_failed"
        | "appeal_resolved"
        | "offer_withdrawn"
      occasion: "date" | "solo" | "friends"
      offer_status: "active" | "accepted" | "passed" | "expired"
      payment_preference: "i_pay" | "they_pay" | "split"
      place_approval_status: "draft" | "live" | "rejected"
      place_type:
        | "restaurant"
        | "cafe"
        | "winery"
        | "brewery"
        | "cocktail_bar"
        | "dessert"
        | "ice_cream"
        | "bakery"
        | "hike"
        | "viewpoint"
        | "beach"
        | "park"
        | "garden"
        | "activity"
        | "gallery"
        | "market"
        | "shop"
        | "sunset_spot"
        | "walk"
      price_tier: "$" | "$$" | "$$$"
      queue_status:
        | "interested"
        | "shortlisted"
        | "offer_active"
        | "offer_passed"
        | "offer_expired"
        | "standby"
        | "locked"
      report_reason_category:
        | "harassment"
        | "safety_threat"
        | "no_show_dispute"
        | "payment_dispute"
        | "inappropriate_content"
        | "fake_profile"
        | "other"
      report_status: "open" | "reviewing" | "actioned" | "dismissed"
      standing_state:
        | "good"
        | "warned"
        | "cooldown"
        | "throttled"
        | "reconfirm_required"
        | "locked_ban"
        | "suspended"
      swipe_direction: "right" | "left"
      verification_state:
        | "unverified"
        | "pending"
        | "verified"
        | "failed"
        | "appeal"
      weather_works_in: "any" | "dry_only" | "indoor_friendly"
    }
    CompositeTypes: {
      geometry_dump: {
        path: number[] | null
        geom: unknown
      }
      valid_detail: {
        valid: boolean | null
        reason: string | null
        location: unknown
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      account_lifecycle: ["active", "paused", "deletion_pending", "deleted"],
      cancel_reason: [
        "schedule_conflict",
        "venue_issue",
        "changed_mind",
        "account_closed",
        "safety",
        "misconduct",
        "other",
      ],
      date_match_status: [
        "none",
        "seeking",
        "matched",
        "completed",
        "cancelled",
      ],
      effort_level: ["low", "moderate", "high"],
      energy_level: ["low", "medium", "high"],
      job_status: ["pending", "running", "done", "failed", "cancelled"],
      job_type: [
        "offer_expiry",
        "standby_roll",
        "pending_expiry",
        "stale_date_close",
        "day_of_reconfirm",
        "safety_checkin",
        "reconfirm_timeout",
        "bulk_withdraw",
        "chat_purge",
        "rating_window",
        "deletion_process",
        "analytics_relay",
        "notify",
      ],
      lock_status: ["active", "completed", "cancelled", "no_show"],
      moderation_status: ["pending", "approved", "rejected"],
      modifier_difficulty: ["tame", "spicy", "chaos"],
      notification_channel: [
        "push_ios",
        "push_android",
        "web_push",
        "email",
        "admin_alert",
        "suppressed",
      ],
      notification_type: [
        "new_match",
        "offer_received",
        "offer_expiring",
        "standby_promoted",
        "date_reconfirm",
        "safety_checkin",
        "safety_alert",
        "new_message",
        "rating_request",
        "moderation_action",
        "account",
        "verification_passed",
        "verification_failed",
        "appeal_resolved",
        "offer_withdrawn",
      ],
      occasion: ["date", "solo", "friends"],
      offer_status: ["active", "accepted", "passed", "expired"],
      payment_preference: ["i_pay", "they_pay", "split"],
      place_approval_status: ["draft", "live", "rejected"],
      place_type: [
        "restaurant",
        "cafe",
        "winery",
        "brewery",
        "cocktail_bar",
        "dessert",
        "ice_cream",
        "bakery",
        "hike",
        "viewpoint",
        "beach",
        "park",
        "garden",
        "activity",
        "gallery",
        "market",
        "shop",
        "sunset_spot",
        "walk",
      ],
      price_tier: ["$", "$$", "$$$"],
      queue_status: [
        "interested",
        "shortlisted",
        "offer_active",
        "offer_passed",
        "offer_expired",
        "standby",
        "locked",
      ],
      report_reason_category: [
        "harassment",
        "safety_threat",
        "no_show_dispute",
        "payment_dispute",
        "inappropriate_content",
        "fake_profile",
        "other",
      ],
      report_status: ["open", "reviewing", "actioned", "dismissed"],
      standing_state: [
        "good",
        "warned",
        "cooldown",
        "throttled",
        "reconfirm_required",
        "locked_ban",
        "suspended",
      ],
      swipe_direction: ["right", "left"],
      verification_state: [
        "unverified",
        "pending",
        "verified",
        "failed",
        "appeal",
      ],
      weather_works_in: ["any", "dry_only", "indoor_friendly"],
    },
  },
} as const

