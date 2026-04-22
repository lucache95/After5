export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
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
      itineraries: {
        Row: {
          built_by_name: string | null
          built_by_neighborhood: string | null
          generated_at: string
          generation_log: Json | null
          hook: string | null
          id: string
          inputs: Json
          intent: string | null
          is_public: boolean
          loved_count: number
          modifier_id: string | null
          planned_for_date: string | null
          season: string | null
          slug: string | null
          stops: Json
          template_id: string | null
          title: string | null
          total_cost_pp: number | null
          total_duration_min: number | null
          user_id: string | null
          when_planned: string | null
          why_it_works: string | null
        }
        Insert: {
          built_by_name?: string | null
          built_by_neighborhood?: string | null
          generated_at?: string
          generation_log?: Json | null
          hook?: string | null
          id?: string
          inputs: Json
          intent?: string | null
          is_public?: boolean
          loved_count?: number
          modifier_id?: string | null
          planned_for_date?: string | null
          season?: string | null
          slug?: string | null
          stops: Json
          template_id?: string | null
          title?: string | null
          total_cost_pp?: number | null
          total_duration_min?: number | null
          user_id?: string | null
          when_planned?: string | null
          why_it_works?: string | null
        }
        Update: {
          built_by_name?: string | null
          built_by_neighborhood?: string | null
          generated_at?: string
          generation_log?: Json | null
          hook?: string | null
          id?: string
          inputs?: Json
          intent?: string | null
          is_public?: boolean
          loved_count?: number
          modifier_id?: string | null
          planned_for_date?: string | null
          season?: string | null
          slug?: string | null
          stops?: Json
          template_id?: string | null
          title?: string | null
          total_cost_pp?: number | null
          total_duration_min?: number | null
          user_id?: string | null
          when_planned?: string | null
          why_it_works?: string | null
        }
        Relationships: [
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
          google_place_id: string | null
          hours_week: Json | null
          id: string
          is_active: boolean
          is_published: boolean
          last_ai_review_at: string | null
          last_ai_review_confidence: number | null
          last_human_review_at: string | null
          last_human_review_by: string | null
          lat: number | null
          llm_summary: string | null
          lng: number | null
          local_insight: string | null
          name: string
          neighborhood: string
          notes: string | null
          opens: string | null
          pairing_tags: string[]
          perceived_value: string | null
          phone: string | null
          photo_quality: string | null
          photo_review_notes: string | null
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
          google_place_id?: string | null
          hours_week?: Json | null
          id?: string
          is_active?: boolean
          is_published?: boolean
          last_ai_review_at?: string | null
          last_ai_review_confidence?: number | null
          last_human_review_at?: string | null
          last_human_review_by?: string | null
          lat?: number | null
          llm_summary?: string | null
          lng?: number | null
          local_insight?: string | null
          name: string
          neighborhood: string
          notes?: string | null
          opens?: string | null
          pairing_tags?: string[]
          perceived_value?: string | null
          phone?: string | null
          photo_quality?: string | null
          photo_review_notes?: string | null
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
          google_place_id?: string | null
          hours_week?: Json | null
          id?: string
          is_active?: boolean
          is_published?: boolean
          last_ai_review_at?: string | null
          last_ai_review_confidence?: number | null
          last_human_review_at?: string | null
          last_human_review_by?: string | null
          lat?: number | null
          llm_summary?: string | null
          lng?: number | null
          local_insight?: string | null
          name?: string
          neighborhood?: string
          notes?: string | null
          opens?: string | null
          pairing_tags?: string[]
          perceived_value?: string | null
          phone?: string | null
          photo_quality?: string | null
          photo_review_notes?: string | null
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
            foreignKeyName: "plan_votes_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vote_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          city: string | null
          created_at: string
          email: string | null
          first_name: string | null
          id: string
          neighborhood: string | null
          updated_at: string
        }
        Insert: {
          city?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id: string
          neighborhood?: string | null
          updated_at?: string
        }
        Update: {
          city?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          neighborhood?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      saved_plans: {
        Row: {
          id: string
          itinerary_id: string
          note: string | null
          saved_at: string
          user_id: string
        }
        Insert: {
          id?: string
          itinerary_id: string
          note?: string | null
          saved_at?: string
          user_id: string
        }
        Update: {
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
      subscribers: {
        Row: {
          city: string | null
          created_at: string
          email: string
          first_name: string | null
          id: string
          itinerary_id: string | null
          location: string | null
          source: string
          user_agent: string | null
        }
        Insert: {
          city?: string | null
          created_at?: string
          email: string
          first_name?: string | null
          id?: string
          itinerary_id?: string | null
          location?: string | null
          source?: string
          user_agent?: string | null
        }
        Update: {
          city?: string | null
          created_at?: string
          email?: string
          first_name?: string | null
          id?: string
          itinerary_id?: string | null
          location?: string | null
          source?: string
          user_agent?: string | null
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
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      effort_level: "low" | "moderate" | "high"
      energy_level: "low" | "medium" | "high"
      modifier_difficulty: "tame" | "spicy" | "chaos"
      occasion: "date" | "solo" | "friends"
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
      weather_works_in: "any" | "dry_only" | "indoor_friendly"
    }
    CompositeTypes: {
      [_ in never]: never
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
  public: {
    Enums: {
      effort_level: ["low", "moderate", "high"],
      energy_level: ["low", "medium", "high"],
      modifier_difficulty: ["tame", "spicy", "chaos"],
      occasion: ["date", "solo", "friends"],
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
      weather_works_in: ["any", "dry_only", "indoor_friendly"],
    },
  },
} as const
