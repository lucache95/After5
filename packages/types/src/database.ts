export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
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
          generated_at: string
          hook: string | null
          id: string
          inputs: Json
          is_public: boolean
          loved_count: number
          stops: Json
          template_id: string | null
          title: string | null
          total_cost_pp: number | null
          total_duration_min: number | null
          user_id: string | null
          why_it_works: string | null
        }
        Insert: {
          generated_at?: string
          hook?: string | null
          id?: string
          inputs: Json
          is_public?: boolean
          loved_count?: number
          stops: Json
          template_id?: string | null
          title?: string | null
          total_cost_pp?: number | null
          total_duration_min?: number | null
          user_id?: string | null
          why_it_works?: string | null
        }
        Update: {
          generated_at?: string
          hook?: string | null
          id?: string
          inputs?: Json
          is_public?: boolean
          loved_count?: number
          stops?: Json
          template_id?: string | null
          title?: string | null
          total_cost_pp?: number | null
          total_duration_min?: number | null
          user_id?: string | null
          why_it_works?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "itineraries_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "templates"
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
      places: {
        Row: {
          address: string | null
          closed_days: number[]
          closes: string | null
          created_at: string
          cuisine: string[]
          drive_cluster: string
          effort: Database["public"]["Enums"]["effort_level"]
          energy: Database["public"]["Enums"]["energy_level"]
          feedback_score: number
          id: string
          is_active: boolean
          lat: number | null
          lng: number | null
          local_insight: string | null
          name: string
          neighborhood: string
          notes: string | null
          opens: string | null
          pairing_tags: string[]
          photo_url: string | null
          price_tier: Database["public"]["Enums"]["price_tier"]
          quality_score: number
          reservation_required: boolean
          reservation_url: string | null
          seasonality: string[]
          slug: string
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
        }
        Insert: {
          address?: string | null
          closed_days?: number[]
          closes?: string | null
          created_at?: string
          cuisine?: string[]
          drive_cluster: string
          effort?: Database["public"]["Enums"]["effort_level"]
          energy?: Database["public"]["Enums"]["energy_level"]
          feedback_score?: number
          id?: string
          is_active?: boolean
          lat?: number | null
          lng?: number | null
          local_insight?: string | null
          name: string
          neighborhood: string
          notes?: string | null
          opens?: string | null
          pairing_tags?: string[]
          photo_url?: string | null
          price_tier?: Database["public"]["Enums"]["price_tier"]
          quality_score?: number
          reservation_required?: boolean
          reservation_url?: string | null
          seasonality?: string[]
          slug: string
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
        }
        Update: {
          address?: string | null
          closed_days?: number[]
          closes?: string | null
          created_at?: string
          cuisine?: string[]
          drive_cluster?: string
          effort?: Database["public"]["Enums"]["effort_level"]
          energy?: Database["public"]["Enums"]["energy_level"]
          feedback_score?: number
          id?: string
          is_active?: boolean
          lat?: number | null
          lng?: number | null
          local_insight?: string | null
          name?: string
          neighborhood?: string
          notes?: string | null
          opens?: string | null
          pairing_tags?: string[]
          photo_url?: string | null
          price_tier?: Database["public"]["Enums"]["price_tier"]
          quality_score?: number
          reservation_required?: boolean
          reservation_url?: string | null
          seasonality?: string[]
          slug?: string
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
        }
        Relationships: []
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
      occasion: "date" | "solo" | "friends"
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
      occasion: ["date", "solo", "friends"],
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
