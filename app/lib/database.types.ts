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
      agent_commission: {
        Row: {
          agent_party_id: number
          amount: number
          amount_paid: number
          balance: number | null
          commission_rate: number
          commission_type: string
          created_at: string
          created_by: string | null
          fabric_purchase_id: number | null
          id: number
          invoice_id: number | null
          status: string
          updated_at: string
          yarn_lot_id: number | null
        }
        Insert: {
          agent_party_id: number
          amount: number
          amount_paid?: number
          balance?: number | null
          commission_rate: number
          commission_type: string
          created_at?: string
          created_by?: string | null
          fabric_purchase_id?: number | null
          id?: number
          invoice_id?: number | null
          status?: string
          updated_at?: string
          yarn_lot_id?: number | null
        }
        Update: {
          agent_party_id?: number
          amount?: number
          amount_paid?: number
          balance?: number | null
          commission_rate?: number
          commission_type?: string
          created_at?: string
          created_by?: string | null
          fabric_purchase_id?: number | null
          id?: number
          invoice_id?: number | null
          status?: string
          updated_at?: string
          yarn_lot_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_commission_agent_party_id_fkey"
            columns: ["agent_party_id"]
            isOneToOne: false
            referencedRelation: "party"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_commission_agent_party_id_fkey"
            columns: ["agent_party_id"]
            isOneToOne: false
            referencedRelation: "v_jobwork_payment_status"
            referencedColumns: ["party_id"]
          },
          {
            foreignKeyName: "agent_commission_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_commission_fabric_purchase_id_fkey"
            columns: ["fabric_purchase_id"]
            isOneToOne: false
            referencedRelation: "fabric_purchase"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_commission_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: true
            referencedRelation: "invoice"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_commission_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: true
            referencedRelation: "v_invoice_delivery_status"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "agent_commission_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: true
            referencedRelation: "v_sales_register"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "agent_commission_yarn_lot_id_fkey"
            columns: ["yarn_lot_id"]
            isOneToOne: false
            referencedRelation: "yarn_lot"
            referencedColumns: ["id"]
          },
        ]
      }
      app_user: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          last_login: string | null
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          status: Database["public"]["Enums"]["employee_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name: string
          id: string
          last_login?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["employee_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          last_login?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["employee_status"]
          updated_at?: string
        }
        Relationships: []
      }
      attendance_day: {
        Row: {
          attendance_date: string
          id: number
          is_working: boolean
          locked_at: string | null
          marked_at: string
          marked_by: string | null
          reason: Database["public"]["Enums"]["non_working_reason"] | null
          remark: string | null
          shift: Database["public"]["Enums"]["shift_code"]
          sync_source: string
        }
        Insert: {
          attendance_date: string
          id?: number
          is_working?: boolean
          locked_at?: string | null
          marked_at?: string
          marked_by?: string | null
          reason?: Database["public"]["Enums"]["non_working_reason"] | null
          remark?: string | null
          shift: Database["public"]["Enums"]["shift_code"]
          sync_source?: string
        }
        Update: {
          attendance_date?: string
          id?: number
          is_working?: boolean
          locked_at?: string | null
          marked_at?: string
          marked_by?: string | null
          reason?: Database["public"]["Enums"]["non_working_reason"] | null
          remark?: string | null
          shift?: Database["public"]["Enums"]["shift_code"]
          sync_source?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_day_marked_by_fkey"
            columns: ["marked_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_entry: {
        Row: {
          actual_in_time: string | null
          actual_out_time: string | null
          attendance_day_id: number
          day_weight: number | null
          employee_id: number
          id: number
          marked_at: string
          marked_by: string | null
          remark: string | null
          shed_no: string | null
          shed_nos: string[] | null
          status: Database["public"]["Enums"]["attendance_status"]
          sync_source: string
        }
        Insert: {
          actual_in_time?: string | null
          actual_out_time?: string | null
          attendance_day_id: number
          day_weight?: number | null
          employee_id: number
          id?: number
          marked_at?: string
          marked_by?: string | null
          remark?: string | null
          shed_no?: string | null
          shed_nos?: string[] | null
          status: Database["public"]["Enums"]["attendance_status"]
          sync_source?: string
        }
        Update: {
          actual_in_time?: string | null
          actual_out_time?: string | null
          attendance_day_id?: number
          day_weight?: number | null
          employee_id?: number
          id?: number
          marked_at?: string
          marked_by?: string | null
          remark?: string | null
          shed_no?: string | null
          shed_nos?: string[] | null
          status?: Database["public"]["Enums"]["attendance_status"]
          sync_source?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_entry_attendance_day_id_fkey"
            columns: ["attendance_day_id"]
            isOneToOne: false
            referencedRelation: "attendance_day"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_entry_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employee"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_entry_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_attendance_detail"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "attendance_entry_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_attendance_monthly"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "attendance_entry_marked_by_fkey"
            columns: ["marked_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          id: number
          new_data: Json | null
          old_data: Json | null
          row_pk: string
          table_name: string
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          id?: number
          new_data?: Json | null
          old_data?: Json | null
          row_pk: string
          table_name: string
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          id?: number
          new_data?: Json | null
          old_data?: Json | null
          row_pk?: string
          table_name?: string
        }
        Relationships: []
      }
      bank_category: {
        Row: {
          active: boolean
          code: string
          created_at: string
          direction: string
          display_order: number
          id: number
          name: string
          pl_treatment: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          direction: string
          display_order?: number
          id?: number
          name: string
          pl_treatment: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          direction?: string
          display_order?: number
          id?: number
          name?: string
          pl_treatment?: string
        }
        Relationships: []
      }
      bank_entry: {
        Row: {
          amount: number
          bank_ledger_id: number
          category_id: number
          created_at: string
          created_by: string | null
          direction: string
          entry_date: string
          entry_no: string | null
          id: number
          mode: string
          notes: string | null
          other_ledger_id: number | null
          reference: string | null
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount: number
          bank_ledger_id: number
          category_id: number
          created_at?: string
          created_by?: string | null
          direction: string
          entry_date?: string
          entry_no?: string | null
          id?: number
          mode?: string
          notes?: string | null
          other_ledger_id?: number | null
          reference?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount?: number
          bank_ledger_id?: number
          category_id?: number
          created_at?: string
          created_by?: string | null
          direction?: string
          entry_date?: string
          entry_no?: string | null
          id?: number
          mode?: string
          notes?: string | null
          other_ledger_id?: number | null
          reference?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_entry_bank_ledger_id_fkey"
            columns: ["bank_ledger_id"]
            isOneToOne: false
            referencedRelation: "ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_entry_bank_ledger_id_fkey"
            columns: ["bank_ledger_id"]
            isOneToOne: false
            referencedRelation: "v_sizing_spend_by_vendor"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "bank_entry_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "bank_category"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_entry_other_ledger_id_fkey"
            columns: ["other_ledger_id"]
            isOneToOne: false
            referencedRelation: "ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_entry_other_ledger_id_fkey"
            columns: ["other_ledger_id"]
            isOneToOne: false
            referencedRelation: "v_sizing_spend_by_vendor"
            referencedColumns: ["vendor_id"]
          },
        ]
      }
      bobbin: {
        Row: {
          bobbin_ends_master_id: number
          bobbin_metre: number
          bobbin_price: number
          code: string
          created_at: string
          created_by: string | null
          description: string
          ends_per_bobbin: number
          gst_pct: number
          id: number
          invoice_no: string | null
          is_lurex: boolean
          jobwork_party_id: number | null
          loading_per_metre: number
          notes: string | null
          original_quantity: number | null
          production_mode: string
          purchase_date: string | null
          quantity: number
          reorder_pieces: number
          status: Database["public"]["Enums"]["record_status"]
          supplier_party_id: number | null
          total_amount: number | null
          updated_at: string
          updated_by: string | null
          vendor_id: number | null
        }
        Insert: {
          bobbin_ends_master_id: number
          bobbin_metre: number
          bobbin_price: number
          code: string
          created_at?: string
          created_by?: string | null
          description: string
          ends_per_bobbin: number
          gst_pct?: number
          id?: number
          invoice_no?: string | null
          is_lurex?: boolean
          jobwork_party_id?: number | null
          loading_per_metre?: number
          notes?: string | null
          original_quantity?: number | null
          production_mode?: string
          purchase_date?: string | null
          quantity?: number
          reorder_pieces?: number
          status?: Database["public"]["Enums"]["record_status"]
          supplier_party_id?: number | null
          total_amount?: number | null
          updated_at?: string
          updated_by?: string | null
          vendor_id?: number | null
        }
        Update: {
          bobbin_ends_master_id?: number
          bobbin_metre?: number
          bobbin_price?: number
          code?: string
          created_at?: string
          created_by?: string | null
          description?: string
          ends_per_bobbin?: number
          gst_pct?: number
          id?: number
          invoice_no?: string | null
          is_lurex?: boolean
          jobwork_party_id?: number | null
          loading_per_metre?: number
          notes?: string | null
          original_quantity?: number | null
          production_mode?: string
          purchase_date?: string | null
          quantity?: number
          reorder_pieces?: number
          status?: Database["public"]["Enums"]["record_status"]
          supplier_party_id?: number | null
          total_amount?: number | null
          updated_at?: string
          updated_by?: string | null
          vendor_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bobbin_bobbin_ends_master_id_fkey"
            columns: ["bobbin_ends_master_id"]
            isOneToOne: false
            referencedRelation: "bobbin_ends_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bobbin_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bobbin_jobwork_party_id_fkey"
            columns: ["jobwork_party_id"]
            isOneToOne: false
            referencedRelation: "jobwork_party"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bobbin_supplier_party_id_fkey"
            columns: ["supplier_party_id"]
            isOneToOne: false
            referencedRelation: "party"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bobbin_supplier_party_id_fkey"
            columns: ["supplier_party_id"]
            isOneToOne: false
            referencedRelation: "v_jobwork_payment_status"
            referencedColumns: ["party_id"]
          },
          {
            foreignKeyName: "bobbin_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
        ]
      }
      bobbin_ends_master: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          ends_count: number
          id: number
          label: string
          notes: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          ends_count: number
          id?: number
          label: string
          notes?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          ends_count?: number
          id?: number
          label?: string
          notes?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bobbin_ends_master_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bobbin_ends_master_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
        ]
      }
      bobbin_purchase: {
        Row: {
          amount_paid: number
          bobbin_id: number
          bobbin_metre: number | null
          bobbin_price: number | null
          created_at: string
          created_by: string | null
          id: number
          invoice_no: string | null
          notes: string | null
          pieces_purchased: number | null
          purchase_date: string | null
          round_off: number
          total_amount: number | null
          updated_at: string
          updated_by: string | null
          vendor_id: number | null
        }
        Insert: {
          amount_paid?: number
          bobbin_id: number
          bobbin_metre?: number | null
          bobbin_price?: number | null
          created_at?: string
          created_by?: string | null
          id?: number
          invoice_no?: string | null
          notes?: string | null
          pieces_purchased?: number | null
          purchase_date?: string | null
          round_off?: number
          total_amount?: number | null
          updated_at?: string
          updated_by?: string | null
          vendor_id?: number | null
        }
        Update: {
          amount_paid?: number
          bobbin_id?: number
          bobbin_metre?: number | null
          bobbin_price?: number | null
          created_at?: string
          created_by?: string | null
          id?: number
          invoice_no?: string | null
          notes?: string | null
          pieces_purchased?: number | null
          purchase_date?: string | null
          round_off?: number
          total_amount?: number | null
          updated_at?: string
          updated_by?: string | null
          vendor_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bobbin_purchase_bobbin_id_fkey"
            columns: ["bobbin_id"]
            isOneToOne: false
            referencedRelation: "bobbin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bobbin_purchase_bobbin_id_fkey"
            columns: ["bobbin_id"]
            isOneToOne: false
            referencedRelation: "v_bobbin_consumption"
            referencedColumns: ["bobbin_id"]
          },
          {
            foreignKeyName: "bobbin_purchase_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bobbin_purchase_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
        ]
      }
      bobbin_return: {
        Row: {
          bobbin_id: number
          created_at: string
          created_by: string | null
          id: number
          jobwork_party_id: number | null
          notes: string | null
          quantity_pcs: number
          reference_no: string | null
          return_date: string
          status: string
          supplier_party_id: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          bobbin_id: number
          created_at?: string
          created_by?: string | null
          id?: number
          jobwork_party_id?: number | null
          notes?: string | null
          quantity_pcs?: number
          reference_no?: string | null
          return_date?: string
          status?: string
          supplier_party_id?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          bobbin_id?: number
          created_at?: string
          created_by?: string | null
          id?: number
          jobwork_party_id?: number | null
          notes?: string | null
          quantity_pcs?: number
          reference_no?: string | null
          return_date?: string
          status?: string
          supplier_party_id?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bobbin_return_bobbin_id_fkey"
            columns: ["bobbin_id"]
            isOneToOne: false
            referencedRelation: "bobbin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bobbin_return_bobbin_id_fkey"
            columns: ["bobbin_id"]
            isOneToOne: false
            referencedRelation: "v_bobbin_consumption"
            referencedColumns: ["bobbin_id"]
          },
          {
            foreignKeyName: "bobbin_return_jobwork_party_id_fkey"
            columns: ["jobwork_party_id"]
            isOneToOne: false
            referencedRelation: "jobwork_party"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bobbin_return_supplier_party_id_fkey"
            columns: ["supplier_party_id"]
            isOneToOne: false
            referencedRelation: "party"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bobbin_return_supplier_party_id_fkey"
            columns: ["supplier_party_id"]
            isOneToOne: false
            referencedRelation: "v_jobwork_payment_status"
            referencedColumns: ["party_id"]
          },
        ]
      }
      bobbin_stock: {
        Row: {
          bobbin_id: number
          customer_id: number | null
          id: number
          location: Database["public"]["Enums"]["bobbin_location"]
          quantity_pcs: number
          updated_at: string
          vendor_id: number | null
        }
        Insert: {
          bobbin_id: number
          customer_id?: number | null
          id?: number
          location: Database["public"]["Enums"]["bobbin_location"]
          quantity_pcs?: number
          updated_at?: string
          vendor_id?: number | null
        }
        Update: {
          bobbin_id?: number
          customer_id?: number | null
          id?: number
          location?: Database["public"]["Enums"]["bobbin_location"]
          quantity_pcs?: number
          updated_at?: string
          vendor_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bobbin_stock_bobbin_id_fkey"
            columns: ["bobbin_id"]
            isOneToOne: false
            referencedRelation: "bobbin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bobbin_stock_bobbin_id_fkey"
            columns: ["bobbin_id"]
            isOneToOne: false
            referencedRelation: "v_bobbin_consumption"
            referencedColumns: ["bobbin_id"]
          },
          {
            foreignKeyName: "bobbin_stock_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bobbin_stock_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_ageing"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "bobbin_stock_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_outstanding"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      company_profile: {
        Row: {
          address_line1: string
          address_line2: string | null
          bank_account_no: string | null
          bank_branch: string | null
          bank_ifsc: string | null
          bank_name: string | null
          base_currency: string
          city: string
          created_at: string
          display_name: string
          email: string | null
          fy_start_month: number
          gstin: string
          gstin_verified_at: string | null
          id: number
          legal_name: string
          logo_url: string | null
          pan: string
          phone: string | null
          pincode: string
          state: string
          updated_at: string
          website: string | null
        }
        Insert: {
          address_line1: string
          address_line2?: string | null
          bank_account_no?: string | null
          bank_branch?: string | null
          bank_ifsc?: string | null
          bank_name?: string | null
          base_currency?: string
          city: string
          created_at?: string
          display_name: string
          email?: string | null
          fy_start_month?: number
          gstin: string
          gstin_verified_at?: string | null
          id?: number
          legal_name: string
          logo_url?: string | null
          pan: string
          phone?: string | null
          pincode: string
          state: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          address_line1?: string
          address_line2?: string | null
          bank_account_no?: string | null
          bank_branch?: string | null
          bank_ifsc?: string | null
          bank_name?: string | null
          base_currency?: string
          city?: string
          created_at?: string
          display_name?: string
          email?: string | null
          fy_start_month?: number
          gstin?: string
          gstin_verified_at?: string | null
          id?: number
          legal_name?: string
          logo_url?: string | null
          pan?: string
          phone?: string | null
          pincode?: string
          state?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      costing_master: {
        Row: {
          approval_status: Database["public"]["Enums"]["approval_status"]
          approved_at: string | null
          approved_by: string | null
          auto_cost_per_m: number
          bobbin_1_id: number | null
          bobbin_1_loading: number | null
          bobbin_2_id: number | null
          bobbin_2_loading: number | null
          calc_snapshot: Json | null
          created_at: string
          created_by: string | null
          fabric_commission_per_m: number
          fabric_length_m: number
          fabric_type: Database["public"]["Enums"]["fabric_type"]
          fabric_width_in: number
          grams_per_m: number | null
          gsm: number | null
          id: number
          notes: string | null
          pick_paise_market: number | null
          pick_ppi: number
          porvai_count_id: number | null
          porvai_kg_per_m: number | null
          porvai_m_per_kg: number | null
          porvai_slevage_length_m: number | null
          porvai_wastage_pct: number
          production_mode: Database["public"]["Enums"]["production_mode"]
          quality_code: string
          quality_name: string
          quoted_cost_per_m: number | null
          reed_count: number
          save_path: Database["public"]["Enums"]["costing_save_path"]
          selvedge_ends: number
          shrinkage_pct: number
          sizing_cost_per_m: number
          source_so_id: number | null
          status: Database["public"]["Enums"]["record_status"]
          tape_length_m: number
          true_cost_per_m: number | null
          updated_at: string
          updated_by: string | null
          use_bobbin_1: boolean
          use_bobbin_2: boolean
          use_porvai: boolean
          vendor_pick_paise: number | null
          warp_commission_per_m: number
          warp_count_id: number
          warp_ends: number | null
          warp_kg_per_m: number | null
          warp_m_per_kg: number | null
          weft_allowance_m: number
          weft_count_id: number
          weft_kg_per_m: number | null
          weft_m_per_kg: number | null
          yarn_wastage_pct: number
        }
        Insert: {
          approval_status?: Database["public"]["Enums"]["approval_status"]
          approved_at?: string | null
          approved_by?: string | null
          auto_cost_per_m?: number
          bobbin_1_id?: number | null
          bobbin_1_loading?: number | null
          bobbin_2_id?: number | null
          bobbin_2_loading?: number | null
          calc_snapshot?: Json | null
          created_at?: string
          created_by?: string | null
          fabric_commission_per_m?: number
          fabric_length_m: number
          fabric_type: Database["public"]["Enums"]["fabric_type"]
          fabric_width_in: number
          grams_per_m?: number | null
          gsm?: number | null
          id?: number
          notes?: string | null
          pick_paise_market?: number | null
          pick_ppi: number
          porvai_count_id?: number | null
          porvai_kg_per_m?: number | null
          porvai_m_per_kg?: number | null
          porvai_slevage_length_m?: number | null
          porvai_wastage_pct?: number
          production_mode: Database["public"]["Enums"]["production_mode"]
          quality_code: string
          quality_name: string
          quoted_cost_per_m?: number | null
          reed_count: number
          save_path?: Database["public"]["Enums"]["costing_save_path"]
          selvedge_ends?: number
          shrinkage_pct?: number
          sizing_cost_per_m?: number
          source_so_id?: number | null
          status?: Database["public"]["Enums"]["record_status"]
          tape_length_m: number
          true_cost_per_m?: number | null
          updated_at?: string
          updated_by?: string | null
          use_bobbin_1?: boolean
          use_bobbin_2?: boolean
          use_porvai?: boolean
          vendor_pick_paise?: number | null
          warp_commission_per_m?: number
          warp_count_id: number
          warp_ends?: number | null
          warp_kg_per_m?: number | null
          warp_m_per_kg?: number | null
          weft_allowance_m?: number
          weft_count_id: number
          weft_kg_per_m?: number | null
          weft_m_per_kg?: number | null
          yarn_wastage_pct?: number
        }
        Update: {
          approval_status?: Database["public"]["Enums"]["approval_status"]
          approved_at?: string | null
          approved_by?: string | null
          auto_cost_per_m?: number
          bobbin_1_id?: number | null
          bobbin_1_loading?: number | null
          bobbin_2_id?: number | null
          bobbin_2_loading?: number | null
          calc_snapshot?: Json | null
          created_at?: string
          created_by?: string | null
          fabric_commission_per_m?: number
          fabric_length_m?: number
          fabric_type?: Database["public"]["Enums"]["fabric_type"]
          fabric_width_in?: number
          grams_per_m?: number | null
          gsm?: number | null
          id?: number
          notes?: string | null
          pick_paise_market?: number | null
          pick_ppi?: number
          porvai_count_id?: number | null
          porvai_kg_per_m?: number | null
          porvai_m_per_kg?: number | null
          porvai_slevage_length_m?: number | null
          porvai_wastage_pct?: number
          production_mode?: Database["public"]["Enums"]["production_mode"]
          quality_code?: string
          quality_name?: string
          quoted_cost_per_m?: number | null
          reed_count?: number
          save_path?: Database["public"]["Enums"]["costing_save_path"]
          selvedge_ends?: number
          shrinkage_pct?: number
          sizing_cost_per_m?: number
          source_so_id?: number | null
          status?: Database["public"]["Enums"]["record_status"]
          tape_length_m?: number
          true_cost_per_m?: number | null
          updated_at?: string
          updated_by?: string | null
          use_bobbin_1?: boolean
          use_bobbin_2?: boolean
          use_porvai?: boolean
          vendor_pick_paise?: number | null
          warp_commission_per_m?: number
          warp_count_id?: number
          warp_ends?: number | null
          warp_kg_per_m?: number | null
          warp_m_per_kg?: number | null
          weft_allowance_m?: number
          weft_count_id?: number
          weft_kg_per_m?: number | null
          weft_m_per_kg?: number | null
          yarn_wastage_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "costing_master_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "costing_master_bobbin_1_id_fkey"
            columns: ["bobbin_1_id"]
            isOneToOne: false
            referencedRelation: "bobbin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "costing_master_bobbin_1_id_fkey"
            columns: ["bobbin_1_id"]
            isOneToOne: false
            referencedRelation: "v_bobbin_consumption"
            referencedColumns: ["bobbin_id"]
          },
          {
            foreignKeyName: "costing_master_bobbin_2_id_fkey"
            columns: ["bobbin_2_id"]
            isOneToOne: false
            referencedRelation: "bobbin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "costing_master_bobbin_2_id_fkey"
            columns: ["bobbin_2_id"]
            isOneToOne: false
            referencedRelation: "v_bobbin_consumption"
            referencedColumns: ["bobbin_id"]
          },
          {
            foreignKeyName: "costing_master_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "costing_master_porvai_count_id_fkey"
            columns: ["porvai_count_id"]
            isOneToOne: false
            referencedRelation: "v_stock_on_hand"
            referencedColumns: ["yarn_count_id"]
          },
          {
            foreignKeyName: "costing_master_porvai_count_id_fkey"
            columns: ["porvai_count_id"]
            isOneToOne: false
            referencedRelation: "v_yarn_cover_dashboard"
            referencedColumns: ["yarn_count_id"]
          },
          {
            foreignKeyName: "costing_master_porvai_count_id_fkey"
            columns: ["porvai_count_id"]
            isOneToOne: false
            referencedRelation: "yarn_count"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "costing_master_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "costing_master_warp_count_id_fkey"
            columns: ["warp_count_id"]
            isOneToOne: false
            referencedRelation: "v_stock_on_hand"
            referencedColumns: ["yarn_count_id"]
          },
          {
            foreignKeyName: "costing_master_warp_count_id_fkey"
            columns: ["warp_count_id"]
            isOneToOne: false
            referencedRelation: "v_yarn_cover_dashboard"
            referencedColumns: ["yarn_count_id"]
          },
          {
            foreignKeyName: "costing_master_warp_count_id_fkey"
            columns: ["warp_count_id"]
            isOneToOne: false
            referencedRelation: "yarn_count"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "costing_master_weft_count_id_fkey"
            columns: ["weft_count_id"]
            isOneToOne: false
            referencedRelation: "v_stock_on_hand"
            referencedColumns: ["yarn_count_id"]
          },
          {
            foreignKeyName: "costing_master_weft_count_id_fkey"
            columns: ["weft_count_id"]
            isOneToOne: false
            referencedRelation: "v_yarn_cover_dashboard"
            referencedColumns: ["yarn_count_id"]
          },
          {
            foreignKeyName: "costing_master_weft_count_id_fkey"
            columns: ["weft_count_id"]
            isOneToOne: false
            referencedRelation: "yarn_count"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_costing_source_so"
            columns: ["source_so_id"]
            isOneToOne: false
            referencedRelation: "sales_order"
            referencedColumns: ["id"]
          },
        ]
      }
      costing_master_bobbin: {
        Row: {
          bobbin_id: number
          costing_id: number
          created_at: string
          created_by: string | null
          id: number
          metres: number | null
          price: number | null
          sort_order: number
          updated_at: string
          updated_by: string | null
          waste: number
        }
        Insert: {
          bobbin_id: number
          costing_id: number
          created_at?: string
          created_by?: string | null
          id?: number
          metres?: number | null
          price?: number | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
          waste?: number
        }
        Update: {
          bobbin_id?: number
          costing_id?: number
          created_at?: string
          created_by?: string | null
          id?: number
          metres?: number | null
          price?: number | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
          waste?: number
        }
        Relationships: [
          {
            foreignKeyName: "costing_master_bobbin_bobbin_id_fkey"
            columns: ["bobbin_id"]
            isOneToOne: false
            referencedRelation: "bobbin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "costing_master_bobbin_bobbin_id_fkey"
            columns: ["bobbin_id"]
            isOneToOne: false
            referencedRelation: "v_bobbin_consumption"
            referencedColumns: ["bobbin_id"]
          },
          {
            foreignKeyName: "costing_master_bobbin_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "costing_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "costing_master_bobbin_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "v_costing_two_cost"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "costing_master_bobbin_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "v_quality_margin"
            referencedColumns: ["costing_id"]
          },
        ]
      }
      customer: {
        Row: {
          billing_address: string
          city: string | null
          code: string
          contact_person: string | null
          created_at: string
          created_by: string | null
          credit_limit: number
          email: string | null
          gstin: string | null
          gstin_verified_at: string | null
          id: number
          is_vip: boolean
          ledger_id: number | null
          name: string
          notes: string | null
          pan: string | null
          payment_terms_days: number
          phone: string | null
          pincode: string | null
          shipping_address: string | null
          state: string | null
          state_code: string | null
          status: Database["public"]["Enums"]["record_status"]
          updated_at: string
          updated_by: string | null
          whatsapp: string | null
        }
        Insert: {
          billing_address: string
          city?: string | null
          code: string
          contact_person?: string | null
          created_at?: string
          created_by?: string | null
          credit_limit?: number
          email?: string | null
          gstin?: string | null
          gstin_verified_at?: string | null
          id?: number
          is_vip?: boolean
          ledger_id?: number | null
          name: string
          notes?: string | null
          pan?: string | null
          payment_terms_days?: number
          phone?: string | null
          pincode?: string | null
          shipping_address?: string | null
          state?: string | null
          state_code?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
          updated_by?: string | null
          whatsapp?: string | null
        }
        Update: {
          billing_address?: string
          city?: string | null
          code?: string
          contact_person?: string | null
          created_at?: string
          created_by?: string | null
          credit_limit?: number
          email?: string | null
          gstin?: string | null
          gstin_verified_at?: string | null
          id?: number
          is_vip?: boolean
          ledger_id?: number | null
          name?: string
          notes?: string | null
          pan?: string | null
          payment_terms_days?: number
          phone?: string | null
          pincode?: string | null
          shipping_address?: string | null
          state?: string | null
          state_code?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
          updated_by?: string | null
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_ledger_id_fkey"
            columns: ["ledger_id"]
            isOneToOne: false
            referencedRelation: "ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_ledger_id_fkey"
            columns: ["ledger_id"]
            isOneToOne: false
            referencedRelation: "v_sizing_spend_by_vendor"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "customer_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_challan: {
        Row: {
          bill_to_address: string | null
          bill_to_gstin: string | null
          bill_to_name: string | null
          bill_to_state: string | null
          bill_to_state_code: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          code: string | null
          created_at: string
          created_by: string | null
          dc_date: string
          distance_km: number | null
          driver_name: string | null
          driver_phone: string | null
          entry_mode: string
          fabric_receipt_id: number | null
          id: number
          invoice_id: number | null
          lr_date: string | null
          lr_no: string | null
          notes: string | null
          party_id: number | null
          production_mode: string
          sales_order_id: number | null
          ship_to_address: string | null
          ship_to_gstin: string | null
          ship_to_name: string | null
          ship_to_party_id: number | null
          ship_to_same: boolean
          ship_to_state: string | null
          ship_to_state_code: string | null
          status: string
          total_amount: number
          total_bundles: number
          total_metres: number
          total_pieces: number
          transport_mode: string | null
          updated_at: string
          updated_by: string | null
          vehicle_no: string | null
          void_code: string | null
        }
        Insert: {
          bill_to_address?: string | null
          bill_to_gstin?: string | null
          bill_to_name?: string | null
          bill_to_state?: string | null
          bill_to_state_code?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          code?: string | null
          created_at?: string
          created_by?: string | null
          dc_date?: string
          distance_km?: number | null
          driver_name?: string | null
          driver_phone?: string | null
          entry_mode?: string
          fabric_receipt_id?: number | null
          id?: number
          invoice_id?: number | null
          lr_date?: string | null
          lr_no?: string | null
          notes?: string | null
          party_id?: number | null
          production_mode?: string
          sales_order_id?: number | null
          ship_to_address?: string | null
          ship_to_gstin?: string | null
          ship_to_name?: string | null
          ship_to_party_id?: number | null
          ship_to_same?: boolean
          ship_to_state?: string | null
          ship_to_state_code?: string | null
          status?: string
          total_amount?: number
          total_bundles?: number
          total_metres?: number
          total_pieces?: number
          transport_mode?: string | null
          updated_at?: string
          updated_by?: string | null
          vehicle_no?: string | null
          void_code?: string | null
        }
        Update: {
          bill_to_address?: string | null
          bill_to_gstin?: string | null
          bill_to_name?: string | null
          bill_to_state?: string | null
          bill_to_state_code?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          code?: string | null
          created_at?: string
          created_by?: string | null
          dc_date?: string
          distance_km?: number | null
          driver_name?: string | null
          driver_phone?: string | null
          entry_mode?: string
          fabric_receipt_id?: number | null
          id?: number
          invoice_id?: number | null
          lr_date?: string | null
          lr_no?: string | null
          notes?: string | null
          party_id?: number | null
          production_mode?: string
          sales_order_id?: number | null
          ship_to_address?: string | null
          ship_to_gstin?: string | null
          ship_to_name?: string | null
          ship_to_party_id?: number | null
          ship_to_same?: boolean
          ship_to_state?: string | null
          ship_to_state_code?: string | null
          status?: string
          total_amount?: number
          total_bundles?: number
          total_metres?: number
          total_pieces?: number
          transport_mode?: string | null
          updated_at?: string
          updated_by?: string | null
          vehicle_no?: string | null
          void_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_challan_fabric_receipt_id_fkey"
            columns: ["fabric_receipt_id"]
            isOneToOne: false
            referencedRelation: "fabric_receipt"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_challan_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoice"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_challan_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_invoice_delivery_status"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "delivery_challan_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_sales_register"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "delivery_challan_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "party"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_challan_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "v_jobwork_payment_status"
            referencedColumns: ["party_id"]
          },
          {
            foreignKeyName: "delivery_challan_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "sales_order"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_challan_ship_to_party_id_fkey"
            columns: ["ship_to_party_id"]
            isOneToOne: false
            referencedRelation: "party"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_challan_ship_to_party_id_fkey"
            columns: ["ship_to_party_id"]
            isOneToOne: false
            referencedRelation: "v_jobwork_payment_status"
            referencedColumns: ["party_id"]
          },
        ]
      }
      delivery_challan_item: {
        Row: {
          bundles: number | null
          bundles_detail: Json | null
          dc_id: number
          description: string | null
          fabric_quality_id: number | null
          hsn: string | null
          id: number
          metres: number | null
          notes: string | null
          pieces: number | null
          production_batch_id: number | null
          sno: number
        }
        Insert: {
          bundles?: number | null
          bundles_detail?: Json | null
          dc_id: number
          description?: string | null
          fabric_quality_id?: number | null
          hsn?: string | null
          id?: number
          metres?: number | null
          notes?: string | null
          pieces?: number | null
          production_batch_id?: number | null
          sno: number
        }
        Update: {
          bundles?: number | null
          bundles_detail?: Json | null
          dc_id?: number
          description?: string | null
          fabric_quality_id?: number | null
          hsn?: string | null
          id?: number
          metres?: number | null
          notes?: string | null
          pieces?: number | null
          production_batch_id?: number | null
          sno?: number
        }
        Relationships: [
          {
            foreignKeyName: "delivery_challan_item_dc_id_fkey"
            columns: ["dc_id"]
            isOneToOne: false
            referencedRelation: "delivery_challan"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_challan_item_fabric_quality_id_fkey"
            columns: ["fabric_quality_id"]
            isOneToOne: false
            referencedRelation: "fabric_quality"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_challan_item_production_batch_id_fkey"
            columns: ["production_batch_id"]
            isOneToOne: false
            referencedRelation: "production_batch"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_challan_item_production_batch_id_fkey"
            columns: ["production_batch_id"]
            isOneToOne: false
            referencedRelation: "v_batch_expense_allocation"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "delivery_challan_item_production_batch_id_fkey"
            columns: ["production_batch_id"]
            isOneToOne: false
            referencedRelation: "v_batch_expense_total"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "delivery_challan_item_production_batch_id_fkey"
            columns: ["production_batch_id"]
            isOneToOne: false
            referencedRelation: "v_batch_sizing_variance"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "delivery_challan_item_production_batch_id_fkey"
            columns: ["production_batch_id"]
            isOneToOne: false
            referencedRelation: "v_batch_wage_allocation"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "delivery_challan_item_production_batch_id_fkey"
            columns: ["production_batch_id"]
            isOneToOne: false
            referencedRelation: "v_batch_wage_total"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "delivery_challan_item_production_batch_id_fkey"
            columns: ["production_batch_id"]
            isOneToOne: false
            referencedRelation: "v_production_batch_with_source"
            referencedColumns: ["id"]
          },
        ]
      }
      doc_sequence: {
        Row: {
          doc_type: string
          format: string
          fy_code: string
          next_value: number
          prefix: string
          reset_yearly: boolean
          updated_at: string
        }
        Insert: {
          doc_type: string
          format: string
          fy_code: string
          next_value?: number
          prefix: string
          reset_yearly?: boolean
          updated_at?: string
        }
        Update: {
          doc_type?: string
          format?: string
          fy_code?: string
          next_value?: number
          prefix?: string
          reset_yearly?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      employee: {
        Row: {
          attendance_required: boolean
          code: string
          created_at: string
          created_by: string | null
          date_of_joining: string | null
          default_sheds: string[]
          default_shift: Database["public"]["Enums"]["shift_preference"]
          full_name: string
          home_shed_no: string | null
          id: number
          id_last4: string | null
          notes: string | null
          phone: string | null
          role: Database["public"]["Enums"]["employee_role"]
          status: Database["public"]["Enums"]["employee_status"]
          updated_at: string
          updated_by: string | null
          wage_alloc_basis: string
          weekly_salary: number | null
        }
        Insert: {
          attendance_required?: boolean
          code: string
          created_at?: string
          created_by?: string | null
          date_of_joining?: string | null
          default_sheds?: string[]
          default_shift?: Database["public"]["Enums"]["shift_preference"]
          full_name: string
          home_shed_no?: string | null
          id?: number
          id_last4?: string | null
          notes?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["employee_role"]
          status?: Database["public"]["Enums"]["employee_status"]
          updated_at?: string
          updated_by?: string | null
          wage_alloc_basis?: string
          weekly_salary?: number | null
        }
        Update: {
          attendance_required?: boolean
          code?: string
          created_at?: string
          created_by?: string | null
          date_of_joining?: string | null
          default_sheds?: string[]
          default_shift?: Database["public"]["Enums"]["shift_preference"]
          full_name?: string
          home_shed_no?: string | null
          id?: number
          id_last4?: string | null
          notes?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["employee_role"]
          status?: Database["public"]["Enums"]["employee_status"]
          updated_at?: string
          updated_by?: string | null
          wage_alloc_basis?: string
          weekly_salary?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_loan: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          employee_id: number
          id: number
          loan_date: string
          notes: string | null
          source_ledger_id: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          employee_id: number
          id?: number
          loan_date?: string
          notes?: string | null
          source_ledger_id?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          employee_id?: number
          id?: number
          loan_date?: string
          notes?: string | null
          source_ledger_id?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_loan_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_loan_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employee"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_loan_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_attendance_detail"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "employee_loan_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_attendance_monthly"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "employee_loan_source_ledger_id_fkey"
            columns: ["source_ledger_id"]
            isOneToOne: false
            referencedRelation: "ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_loan_source_ledger_id_fkey"
            columns: ["source_ledger_id"]
            isOneToOne: false
            referencedRelation: "v_sizing_spend_by_vendor"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "employee_loan_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
        ]
      }
      ends_master: {
        Row: {
          active: boolean
          code: string
          count_id: number | null
          created_at: string
          created_by: string | null
          ends_count: number
          id: number
          name: string
          notes: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          code: string
          count_id?: number | null
          created_at?: string
          created_by?: string | null
          ends_count: number
          id?: number
          name: string
          notes?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          code?: string
          count_id?: number | null
          created_at?: string
          created_by?: string | null
          ends_count?: number
          id?: number
          name?: string
          notes?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ends_master_count_id_fkey"
            columns: ["count_id"]
            isOneToOne: false
            referencedRelation: "v_stock_on_hand"
            referencedColumns: ["yarn_count_id"]
          },
          {
            foreignKeyName: "ends_master_count_id_fkey"
            columns: ["count_id"]
            isOneToOne: false
            referencedRelation: "v_yarn_cover_dashboard"
            referencedColumns: ["yarn_count_id"]
          },
          {
            foreignKeyName: "ends_master_count_id_fkey"
            columns: ["count_id"]
            isOneToOne: false
            referencedRelation: "yarn_count"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ends_master_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ends_master_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_category: {
        Row: {
          created_at: string
          id: number
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: number
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: number
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      expense_entry: {
        Row: {
          amount: number
          category: string
          created_at: string
          created_by: string | null
          id: number
          notes: string | null
          pay_date: string
          source_ledger_id: number | null
          target_ledger_id: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount: number
          category: string
          created_at?: string
          created_by?: string | null
          id?: number
          notes?: string | null
          pay_date: string
          source_ledger_id?: number | null
          target_ledger_id?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          created_by?: string | null
          id?: number
          notes?: string | null
          pay_date?: string
          source_ledger_id?: number | null
          target_ledger_id?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_entry_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_entry_source_ledger_id_fkey"
            columns: ["source_ledger_id"]
            isOneToOne: false
            referencedRelation: "ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_entry_source_ledger_id_fkey"
            columns: ["source_ledger_id"]
            isOneToOne: false
            referencedRelation: "v_sizing_spend_by_vendor"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "expense_entry_target_ledger_id_fkey"
            columns: ["target_ledger_id"]
            isOneToOne: false
            referencedRelation: "ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_entry_target_ledger_id_fkey"
            columns: ["target_ledger_id"]
            isOneToOne: false
            referencedRelation: "v_sizing_spend_by_vendor"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "expense_entry_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
        ]
      }
      fabric_purchase: {
        Row: {
          amount_paid: number
          code: string
          created_at: string
          created_by: string | null
          current_metres: number | null
          delivery_destination: Database["public"]["Enums"]["fabric_delivery_destination"]
          fabric_quality_id: number | null
          gst_pct: number
          id: number
          invoice_no: string
          notes: string | null
          quality_text: string | null
          rate: number
          rate_unit: Database["public"]["Enums"]["fabric_rate_unit"]
          received_date: string
          received_metres: number | null
          received_pieces: number | null
          round_off: number
          source: string
          status: Database["public"]["Enums"]["record_status"]
          supplier_party_id: number | null
          total_amount: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount_paid?: number
          code: string
          created_at?: string
          created_by?: string | null
          current_metres?: number | null
          delivery_destination?: Database["public"]["Enums"]["fabric_delivery_destination"]
          fabric_quality_id?: number | null
          gst_pct?: number
          id?: number
          invoice_no: string
          notes?: string | null
          quality_text?: string | null
          rate: number
          rate_unit?: Database["public"]["Enums"]["fabric_rate_unit"]
          received_date?: string
          received_metres?: number | null
          received_pieces?: number | null
          round_off?: number
          source?: string
          status?: Database["public"]["Enums"]["record_status"]
          supplier_party_id?: number | null
          total_amount?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount_paid?: number
          code?: string
          created_at?: string
          created_by?: string | null
          current_metres?: number | null
          delivery_destination?: Database["public"]["Enums"]["fabric_delivery_destination"]
          fabric_quality_id?: number | null
          gst_pct?: number
          id?: number
          invoice_no?: string
          notes?: string | null
          quality_text?: string | null
          rate?: number
          rate_unit?: Database["public"]["Enums"]["fabric_rate_unit"]
          received_date?: string
          received_metres?: number | null
          received_pieces?: number | null
          round_off?: number
          source?: string
          status?: Database["public"]["Enums"]["record_status"]
          supplier_party_id?: number | null
          total_amount?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fabric_purchase_fabric_quality_id_fkey"
            columns: ["fabric_quality_id"]
            isOneToOne: false
            referencedRelation: "fabric_quality"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fabric_purchase_supplier_party_id_fkey"
            columns: ["supplier_party_id"]
            isOneToOne: false
            referencedRelation: "party"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fabric_purchase_supplier_party_id_fkey"
            columns: ["supplier_party_id"]
            isOneToOne: false
            referencedRelation: "v_jobwork_payment_status"
            referencedColumns: ["party_id"]
          },
        ]
      }
      fabric_quality: {
        Row: {
          active: boolean
          bobbin_pcs_per_m: number | null
          calc_snapshot: Json | null
          code: string
          costing_id: number | null
          created_at: string
          created_by: string | null
          crimp_pct: number | null
          fabric_type: string | null
          gst_pct: number | null
          hsn: string | null
          id: number
          is_merged: boolean
          merged_name: string | null
          meter_per_pc: number | null
          name: string
          notes: string | null
          output_unit: string | null
          output_value: number | null
          pick_cost_per_m: number | null
          pick_per_inch: number | null
          porvai_kg_per_m: number | null
          production_mode:
            | Database["public"]["Enums"]["fabric_production_mode"]
            | null
          quality_for_sales: string | null
          rate_per_m: number | null
          reed: number | null
          reed_space: number | null
          updated_at: string
          updated_by: string | null
          weft_kg_per_m: number | null
          weight_gsm: number | null
          width_in: number | null
        }
        Insert: {
          active?: boolean
          bobbin_pcs_per_m?: number | null
          calc_snapshot?: Json | null
          code: string
          costing_id?: number | null
          created_at?: string
          created_by?: string | null
          crimp_pct?: number | null
          fabric_type?: string | null
          gst_pct?: number | null
          hsn?: string | null
          id?: number
          is_merged?: boolean
          merged_name?: string | null
          meter_per_pc?: number | null
          name: string
          notes?: string | null
          output_unit?: string | null
          output_value?: number | null
          pick_cost_per_m?: number | null
          pick_per_inch?: number | null
          porvai_kg_per_m?: number | null
          production_mode?:
            | Database["public"]["Enums"]["fabric_production_mode"]
            | null
          quality_for_sales?: string | null
          rate_per_m?: number | null
          reed?: number | null
          reed_space?: number | null
          updated_at?: string
          updated_by?: string | null
          weft_kg_per_m?: number | null
          weight_gsm?: number | null
          width_in?: number | null
        }
        Update: {
          active?: boolean
          bobbin_pcs_per_m?: number | null
          calc_snapshot?: Json | null
          code?: string
          costing_id?: number | null
          created_at?: string
          created_by?: string | null
          crimp_pct?: number | null
          fabric_type?: string | null
          gst_pct?: number | null
          hsn?: string | null
          id?: number
          is_merged?: boolean
          merged_name?: string | null
          meter_per_pc?: number | null
          name?: string
          notes?: string | null
          output_unit?: string | null
          output_value?: number | null
          pick_cost_per_m?: number | null
          pick_per_inch?: number | null
          porvai_kg_per_m?: number | null
          production_mode?:
            | Database["public"]["Enums"]["fabric_production_mode"]
            | null
          quality_for_sales?: string | null
          rate_per_m?: number | null
          reed?: number | null
          reed_space?: number | null
          updated_at?: string
          updated_by?: string | null
          weft_kg_per_m?: number | null
          weight_gsm?: number | null
          width_in?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fabric_quality_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "costing_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fabric_quality_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "v_costing_two_cost"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fabric_quality_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "v_quality_margin"
            referencedColumns: ["costing_id"]
          },
          {
            foreignKeyName: "fabric_quality_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fabric_quality_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
        ]
      }
      fabric_quality_ends: {
        Row: {
          ends_id: number | null
          fabric_quality_id: number
          id: number
          sno: number
        }
        Insert: {
          ends_id?: number | null
          fabric_quality_id: number
          id?: number
          sno: number
        }
        Update: {
          ends_id?: number | null
          fabric_quality_id?: number
          id?: number
          sno?: number
        }
        Relationships: [
          {
            foreignKeyName: "fabric_quality_ends_ends_id_fkey"
            columns: ["ends_id"]
            isOneToOne: false
            referencedRelation: "ends_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fabric_quality_ends_fabric_quality_id_fkey"
            columns: ["fabric_quality_id"]
            isOneToOne: false
            referencedRelation: "fabric_quality"
            referencedColumns: ["id"]
          },
        ]
      }
      fabric_quality_warp_count: {
        Row: {
          fabric_quality_id: number
          id: number
          sno: number
          yarn_count_id: number | null
        }
        Insert: {
          fabric_quality_id: number
          id?: number
          sno: number
          yarn_count_id?: number | null
        }
        Update: {
          fabric_quality_id?: number
          id?: number
          sno?: number
          yarn_count_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fabric_quality_warp_count_fabric_quality_id_fkey"
            columns: ["fabric_quality_id"]
            isOneToOne: false
            referencedRelation: "fabric_quality"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fabric_quality_warp_count_yarn_count_id_fkey"
            columns: ["yarn_count_id"]
            isOneToOne: false
            referencedRelation: "v_stock_on_hand"
            referencedColumns: ["yarn_count_id"]
          },
          {
            foreignKeyName: "fabric_quality_warp_count_yarn_count_id_fkey"
            columns: ["yarn_count_id"]
            isOneToOne: false
            referencedRelation: "v_yarn_cover_dashboard"
            referencedColumns: ["yarn_count_id"]
          },
          {
            foreignKeyName: "fabric_quality_warp_count_yarn_count_id_fkey"
            columns: ["yarn_count_id"]
            isOneToOne: false
            referencedRelation: "yarn_count"
            referencedColumns: ["id"]
          },
        ]
      }
      fabric_quality_weaving_rate: {
        Row: {
          fabric_quality_id: number
          fabric_type: string | null
          id: number
          rate_per_meter: number | null
          sno: number
        }
        Insert: {
          fabric_quality_id: number
          fabric_type?: string | null
          id?: number
          rate_per_meter?: number | null
          sno: number
        }
        Update: {
          fabric_quality_id?: number
          fabric_type?: string | null
          id?: number
          rate_per_meter?: number | null
          sno?: number
        }
        Relationships: [
          {
            foreignKeyName: "fabric_quality_weaving_rate_fabric_quality_id_fkey"
            columns: ["fabric_quality_id"]
            isOneToOne: false
            referencedRelation: "fabric_quality"
            referencedColumns: ["id"]
          },
        ]
      }
      fabric_quality_weft: {
        Row: {
          fabric_quality_id: number
          id: number
          meter_per_kg: number | null
          sno: number
          wgt_per_mtr_actual: number | null
          wgt_per_mtr_manual: number | null
          yarn_count_id: number | null
        }
        Insert: {
          fabric_quality_id: number
          id?: number
          meter_per_kg?: number | null
          sno: number
          wgt_per_mtr_actual?: number | null
          wgt_per_mtr_manual?: number | null
          yarn_count_id?: number | null
        }
        Update: {
          fabric_quality_id?: number
          id?: number
          meter_per_kg?: number | null
          sno?: number
          wgt_per_mtr_actual?: number | null
          wgt_per_mtr_manual?: number | null
          yarn_count_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fabric_quality_weft_fabric_quality_id_fkey"
            columns: ["fabric_quality_id"]
            isOneToOne: false
            referencedRelation: "fabric_quality"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fabric_quality_weft_yarn_count_id_fkey"
            columns: ["yarn_count_id"]
            isOneToOne: false
            referencedRelation: "v_stock_on_hand"
            referencedColumns: ["yarn_count_id"]
          },
          {
            foreignKeyName: "fabric_quality_weft_yarn_count_id_fkey"
            columns: ["yarn_count_id"]
            isOneToOne: false
            referencedRelation: "v_yarn_cover_dashboard"
            referencedColumns: ["yarn_count_id"]
          },
          {
            foreignKeyName: "fabric_quality_weft_yarn_count_id_fkey"
            columns: ["yarn_count_id"]
            isOneToOne: false
            referencedRelation: "yarn_count"
            referencedColumns: ["id"]
          },
        ]
      }
      fabric_receipt: {
        Row: {
          code: string | null
          created_at: string
          created_by: string | null
          dc_id: number | null
          empty_beams: number | null
          freight_charges: number | null
          id: number
          party_dc_no: string | null
          party_id: number | null
          receipt_date: string
          receipt_type: string
          remarks: string | null
          status: string
          stock_snapshot: Json | null
          total_metres: number | null
          total_pieces: number | null
          transport_mode: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string
          created_by?: string | null
          dc_id?: number | null
          empty_beams?: number | null
          freight_charges?: number | null
          id?: number
          party_dc_no?: string | null
          party_id?: number | null
          receipt_date?: string
          receipt_type?: string
          remarks?: string | null
          status?: string
          stock_snapshot?: Json | null
          total_metres?: number | null
          total_pieces?: number | null
          transport_mode?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string
          created_by?: string | null
          dc_id?: number | null
          empty_beams?: number | null
          freight_charges?: number | null
          id?: number
          party_dc_no?: string | null
          party_id?: number | null
          receipt_date?: string
          receipt_type?: string
          remarks?: string | null
          status?: string
          stock_snapshot?: Json | null
          total_metres?: number | null
          total_pieces?: number | null
          transport_mode?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fabric_receipt_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fabric_receipt_dc_id_fkey"
            columns: ["dc_id"]
            isOneToOne: false
            referencedRelation: "delivery_challan"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fabric_receipt_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "party"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fabric_receipt_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "v_jobwork_payment_status"
            referencedColumns: ["party_id"]
          },
          {
            foreignKeyName: "fabric_receipt_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
        ]
      }
      fabric_receipt_item: {
        Row: {
          bobbin_consumed_pcs: number | null
          bobbin_id: number | null
          bobbin_pcs_per_m: number | null
          ends_count_snapshot: number | null
          ends_id: number | null
          entry_mode: string
          fabric_quality_id: number | null
          fd_pct: number | null
          id: number
          length_per_pc: number | null
          no_of_pieces: number | null
          notes: string | null
          porvai_consumed_kg: number | null
          porvai_kg_per_m: number | null
          porvai_yarn_count_id: number | null
          product: string | null
          qty: number | null
          receipt_id: number
          received_metres: number
          sno: number
          weft_consumed_kg: number | null
          weft_kg_per_m: number | null
          weft_yarn_count_id: number | null
        }
        Insert: {
          bobbin_consumed_pcs?: number | null
          bobbin_id?: number | null
          bobbin_pcs_per_m?: number | null
          ends_count_snapshot?: number | null
          ends_id?: number | null
          entry_mode?: string
          fabric_quality_id?: number | null
          fd_pct?: number | null
          id?: number
          length_per_pc?: number | null
          no_of_pieces?: number | null
          notes?: string | null
          porvai_consumed_kg?: number | null
          porvai_kg_per_m?: number | null
          porvai_yarn_count_id?: number | null
          product?: string | null
          qty?: number | null
          receipt_id: number
          received_metres?: number
          sno?: number
          weft_consumed_kg?: number | null
          weft_kg_per_m?: number | null
          weft_yarn_count_id?: number | null
        }
        Update: {
          bobbin_consumed_pcs?: number | null
          bobbin_id?: number | null
          bobbin_pcs_per_m?: number | null
          ends_count_snapshot?: number | null
          ends_id?: number | null
          entry_mode?: string
          fabric_quality_id?: number | null
          fd_pct?: number | null
          id?: number
          length_per_pc?: number | null
          no_of_pieces?: number | null
          notes?: string | null
          porvai_consumed_kg?: number | null
          porvai_kg_per_m?: number | null
          porvai_yarn_count_id?: number | null
          product?: string | null
          qty?: number | null
          receipt_id?: number
          received_metres?: number
          sno?: number
          weft_consumed_kg?: number | null
          weft_kg_per_m?: number | null
          weft_yarn_count_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fabric_receipt_item_bobbin_id_fkey"
            columns: ["bobbin_id"]
            isOneToOne: false
            referencedRelation: "bobbin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fabric_receipt_item_bobbin_id_fkey"
            columns: ["bobbin_id"]
            isOneToOne: false
            referencedRelation: "v_bobbin_consumption"
            referencedColumns: ["bobbin_id"]
          },
          {
            foreignKeyName: "fabric_receipt_item_ends_id_fkey"
            columns: ["ends_id"]
            isOneToOne: false
            referencedRelation: "ends_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fabric_receipt_item_fabric_quality_id_fkey"
            columns: ["fabric_quality_id"]
            isOneToOne: false
            referencedRelation: "fabric_quality"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fabric_receipt_item_porvai_yarn_count_id_fkey"
            columns: ["porvai_yarn_count_id"]
            isOneToOne: false
            referencedRelation: "v_stock_on_hand"
            referencedColumns: ["yarn_count_id"]
          },
          {
            foreignKeyName: "fabric_receipt_item_porvai_yarn_count_id_fkey"
            columns: ["porvai_yarn_count_id"]
            isOneToOne: false
            referencedRelation: "v_yarn_cover_dashboard"
            referencedColumns: ["yarn_count_id"]
          },
          {
            foreignKeyName: "fabric_receipt_item_porvai_yarn_count_id_fkey"
            columns: ["porvai_yarn_count_id"]
            isOneToOne: false
            referencedRelation: "yarn_count"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fabric_receipt_item_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "fabric_receipt"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fabric_receipt_item_weft_yarn_count_id_fkey"
            columns: ["weft_yarn_count_id"]
            isOneToOne: false
            referencedRelation: "v_stock_on_hand"
            referencedColumns: ["yarn_count_id"]
          },
          {
            foreignKeyName: "fabric_receipt_item_weft_yarn_count_id_fkey"
            columns: ["weft_yarn_count_id"]
            isOneToOne: false
            referencedRelation: "v_yarn_cover_dashboard"
            referencedColumns: ["yarn_count_id"]
          },
          {
            foreignKeyName: "fabric_receipt_item_weft_yarn_count_id_fkey"
            columns: ["weft_yarn_count_id"]
            isOneToOne: false
            referencedRelation: "yarn_count"
            referencedColumns: ["id"]
          },
        ]
      }
      fabric_stock: {
        Row: {
          batch_id: number | null
          cost_per_m_frozen: number
          costing_id: number
          id: number
          jw_id: number | null
          metres_available: number | null
          metres_in: number
          metres_out: number
          ow_id: number | null
          received_at: string
          resale_lot_id: number | null
          source_type: string
        }
        Insert: {
          batch_id?: number | null
          cost_per_m_frozen: number
          costing_id: number
          id?: number
          jw_id?: number | null
          metres_available?: number | null
          metres_in: number
          metres_out?: number
          ow_id?: number | null
          received_at?: string
          resale_lot_id?: number | null
          source_type: string
        }
        Update: {
          batch_id?: number | null
          cost_per_m_frozen?: number
          costing_id?: number
          id?: number
          jw_id?: number | null
          metres_available?: number | null
          metres_in?: number
          metres_out?: number
          ow_id?: number | null
          received_at?: string
          resale_lot_id?: number | null
          source_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "fabric_stock_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "production_batch"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fabric_stock_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "v_batch_expense_allocation"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "fabric_stock_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "v_batch_expense_total"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "fabric_stock_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "v_batch_sizing_variance"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "fabric_stock_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "v_batch_wage_allocation"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "fabric_stock_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "v_batch_wage_total"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "fabric_stock_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "v_production_batch_with_source"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fabric_stock_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "costing_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fabric_stock_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "v_costing_two_cost"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fabric_stock_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "v_quality_margin"
            referencedColumns: ["costing_id"]
          },
          {
            foreignKeyName: "fabric_stock_jw_id_fkey"
            columns: ["jw_id"]
            isOneToOne: false
            referencedRelation: "jobwork_order"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fabric_stock_ow_id_fkey"
            columns: ["ow_id"]
            isOneToOne: false
            referencedRelation: "outsource_order"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fabric_stock_resale_lot_id_fkey"
            columns: ["resale_lot_id"]
            isOneToOne: false
            referencedRelation: "resale_lot"
            referencedColumns: ["id"]
          },
        ]
      }
      fabric_type_master: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: number
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: number
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: number
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      general_purchase: {
        Row: {
          amount_paid: number
          bill_date: string
          bill_no: string
          created_at: string
          created_by: string | null
          description: string | null
          gst_pct: number
          id: number
          round_off: number
          status: Database["public"]["Enums"]["record_status"]
          supplier_party_id: number
          taxable: number
          total: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount_paid?: number
          bill_date?: string
          bill_no: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          gst_pct?: number
          id?: number
          round_off?: number
          status?: Database["public"]["Enums"]["record_status"]
          supplier_party_id: number
          taxable: number
          total?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount_paid?: number
          bill_date?: string
          bill_no?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          gst_pct?: number
          id?: number
          round_off?: number
          status?: Database["public"]["Enums"]["record_status"]
          supplier_party_id?: number
          taxable?: number
          total?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "general_purchase_supplier_party_id_fkey"
            columns: ["supplier_party_id"]
            isOneToOne: false
            referencedRelation: "party"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "general_purchase_supplier_party_id_fkey"
            columns: ["supplier_party_id"]
            isOneToOne: false
            referencedRelation: "v_jobwork_payment_status"
            referencedColumns: ["party_id"]
          },
        ]
      }
      inhouse_warp_beam_purchase: {
        Row: {
          code: string | null
          created_at: string
          created_by: string | null
          ends_id: number | null
          fabric_quality_id: number | null
          gst_pct: number
          id: number
          metres: number
          notes: string | null
          purchase_date: string
          rate_per_metre: number
          status: Database["public"]["Enums"]["record_status"]
          supplier_party_id: number | null
          total_amount: number | null
          updated_at: string
          updated_by: string | null
          yarn_count_id: number | null
        }
        Insert: {
          code?: string | null
          created_at?: string
          created_by?: string | null
          ends_id?: number | null
          fabric_quality_id?: number | null
          gst_pct?: number
          id?: number
          metres: number
          notes?: string | null
          purchase_date?: string
          rate_per_metre: number
          status?: Database["public"]["Enums"]["record_status"]
          supplier_party_id?: number | null
          total_amount?: number | null
          updated_at?: string
          updated_by?: string | null
          yarn_count_id?: number | null
        }
        Update: {
          code?: string | null
          created_at?: string
          created_by?: string | null
          ends_id?: number | null
          fabric_quality_id?: number | null
          gst_pct?: number
          id?: number
          metres?: number
          notes?: string | null
          purchase_date?: string
          rate_per_metre?: number
          status?: Database["public"]["Enums"]["record_status"]
          supplier_party_id?: number | null
          total_amount?: number | null
          updated_at?: string
          updated_by?: string | null
          yarn_count_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inhouse_warp_beam_purchase_ends_id_fkey"
            columns: ["ends_id"]
            isOneToOne: false
            referencedRelation: "ends_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inhouse_warp_beam_purchase_fabric_quality_id_fkey"
            columns: ["fabric_quality_id"]
            isOneToOne: false
            referencedRelation: "fabric_quality"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inhouse_warp_beam_purchase_supplier_party_id_fkey"
            columns: ["supplier_party_id"]
            isOneToOne: false
            referencedRelation: "party"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inhouse_warp_beam_purchase_supplier_party_id_fkey"
            columns: ["supplier_party_id"]
            isOneToOne: false
            referencedRelation: "v_jobwork_payment_status"
            referencedColumns: ["party_id"]
          },
          {
            foreignKeyName: "inhouse_warp_beam_purchase_yarn_count_id_fkey"
            columns: ["yarn_count_id"]
            isOneToOne: false
            referencedRelation: "v_stock_on_hand"
            referencedColumns: ["yarn_count_id"]
          },
          {
            foreignKeyName: "inhouse_warp_beam_purchase_yarn_count_id_fkey"
            columns: ["yarn_count_id"]
            isOneToOne: false
            referencedRelation: "v_yarn_cover_dashboard"
            referencedColumns: ["yarn_count_id"]
          },
          {
            foreignKeyName: "inhouse_warp_beam_purchase_yarn_count_id_fkey"
            columns: ["yarn_count_id"]
            isOneToOne: false
            referencedRelation: "yarn_count"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice: {
        Row: {
          amount_paid: number
          balance: number | null
          cgst_amount: number
          created_at: string
          created_by: string | null
          customer_id: number | null
          doc_type: Database["public"]["Enums"]["invoice_doc_type"]
          due_date: string | null
          ewaybill_date: string | null
          ewaybill_no: string | null
          ewaybill_notes: string | null
          ewaybill_valid_till: string | null
          extra_charge: number
          gst_amount: number
          id: number
          igst_amount: number
          invoice_date: string
          invoice_no: string
          is_interstate: boolean
          jobwork_party_id: number | null
          ledger_id: number | null
          notes: string | null
          original_invoice_id: number | null
          party_gstin: string | null
          party_name: string | null
          party_state: string | null
          pdf_url: string | null
          place_of_supply: string | null
          round_off: number
          sgst_amount: number
          ship_to_address: string | null
          ship_to_gstin: string | null
          ship_to_name: string | null
          ship_to_party_id: number | null
          ship_to_state: string | null
          so_id: number | null
          source_kind: Database["public"]["Enums"]["invoice_source_kind"]
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal: number
          supplier_bill_date: string | null
          supplier_bill_no: string | null
          taxable_value: number
          total: number
          updated_at: string
          updated_by: string | null
          vehicle_no: string | null
        }
        Insert: {
          amount_paid?: number
          balance?: number | null
          cgst_amount?: number
          created_at?: string
          created_by?: string | null
          customer_id?: number | null
          doc_type?: Database["public"]["Enums"]["invoice_doc_type"]
          due_date?: string | null
          ewaybill_date?: string | null
          ewaybill_no?: string | null
          ewaybill_notes?: string | null
          ewaybill_valid_till?: string | null
          extra_charge?: number
          gst_amount?: number
          id?: number
          igst_amount?: number
          invoice_date?: string
          invoice_no: string
          is_interstate?: boolean
          jobwork_party_id?: number | null
          ledger_id?: number | null
          notes?: string | null
          original_invoice_id?: number | null
          party_gstin?: string | null
          party_name?: string | null
          party_state?: string | null
          pdf_url?: string | null
          place_of_supply?: string | null
          round_off?: number
          sgst_amount?: number
          ship_to_address?: string | null
          ship_to_gstin?: string | null
          ship_to_name?: string | null
          ship_to_party_id?: number | null
          ship_to_state?: string | null
          so_id?: number | null
          source_kind?: Database["public"]["Enums"]["invoice_source_kind"]
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          supplier_bill_date?: string | null
          supplier_bill_no?: string | null
          taxable_value?: number
          total?: number
          updated_at?: string
          updated_by?: string | null
          vehicle_no?: string | null
        }
        Update: {
          amount_paid?: number
          balance?: number | null
          cgst_amount?: number
          created_at?: string
          created_by?: string | null
          customer_id?: number | null
          doc_type?: Database["public"]["Enums"]["invoice_doc_type"]
          due_date?: string | null
          ewaybill_date?: string | null
          ewaybill_no?: string | null
          ewaybill_notes?: string | null
          ewaybill_valid_till?: string | null
          extra_charge?: number
          gst_amount?: number
          id?: number
          igst_amount?: number
          invoice_date?: string
          invoice_no?: string
          is_interstate?: boolean
          jobwork_party_id?: number | null
          ledger_id?: number | null
          notes?: string | null
          original_invoice_id?: number | null
          party_gstin?: string | null
          party_name?: string | null
          party_state?: string | null
          pdf_url?: string | null
          place_of_supply?: string | null
          round_off?: number
          sgst_amount?: number
          ship_to_address?: string | null
          ship_to_gstin?: string | null
          ship_to_name?: string | null
          ship_to_party_id?: number | null
          ship_to_state?: string | null
          so_id?: number | null
          source_kind?: Database["public"]["Enums"]["invoice_source_kind"]
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          supplier_bill_date?: string | null
          supplier_bill_no?: string | null
          taxable_value?: number
          total?: number
          updated_at?: string
          updated_by?: string | null
          vehicle_no?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_ageing"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "invoice_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_outstanding"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "invoice_jobwork_party_id_fkey"
            columns: ["jobwork_party_id"]
            isOneToOne: false
            referencedRelation: "party"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_jobwork_party_id_fkey"
            columns: ["jobwork_party_id"]
            isOneToOne: false
            referencedRelation: "v_jobwork_payment_status"
            referencedColumns: ["party_id"]
          },
          {
            foreignKeyName: "invoice_ledger_id_fkey"
            columns: ["ledger_id"]
            isOneToOne: false
            referencedRelation: "ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_ledger_id_fkey"
            columns: ["ledger_id"]
            isOneToOne: false
            referencedRelation: "v_sizing_spend_by_vendor"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "invoice_original_invoice_id_fkey"
            columns: ["original_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoice"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_original_invoice_id_fkey"
            columns: ["original_invoice_id"]
            isOneToOne: false
            referencedRelation: "v_invoice_delivery_status"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "invoice_original_invoice_id_fkey"
            columns: ["original_invoice_id"]
            isOneToOne: false
            referencedRelation: "v_sales_register"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "invoice_ship_to_party_id_fkey"
            columns: ["ship_to_party_id"]
            isOneToOne: false
            referencedRelation: "party"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_ship_to_party_id_fkey"
            columns: ["ship_to_party_id"]
            isOneToOne: false
            referencedRelation: "v_jobwork_payment_status"
            referencedColumns: ["party_id"]
          },
          {
            foreignKeyName: "invoice_so_id_fkey"
            columns: ["so_id"]
            isOneToOne: false
            referencedRelation: "sales_order"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_line: {
        Row: {
          cgst_amount: number
          costing_id: number | null
          description: string
          discount_amount: number
          discount_pct: number
          fabric_purchase_id: number | null
          fabric_quality_id: number | null
          fabric_stock_id: number | null
          gst_rate_pct: number
          hsn_sac: string | null
          id: number
          igst_amount: number
          invoice_id: number
          jobwork_cost_per_m: number | null
          original_line_id: number | null
          quantity: number
          rate: number
          resale_lot_id: number | null
          sgst_amount: number
          so_line_id: number | null
          taxable_amount: number
          total_amount: number
          uom: string
          yarn_lot_id: number | null
        }
        Insert: {
          cgst_amount?: number
          costing_id?: number | null
          description: string
          discount_amount?: number
          discount_pct?: number
          fabric_purchase_id?: number | null
          fabric_quality_id?: number | null
          fabric_stock_id?: number | null
          gst_rate_pct?: number
          hsn_sac?: string | null
          id?: number
          igst_amount?: number
          invoice_id: number
          jobwork_cost_per_m?: number | null
          original_line_id?: number | null
          quantity: number
          rate: number
          resale_lot_id?: number | null
          sgst_amount?: number
          so_line_id?: number | null
          taxable_amount?: number
          total_amount?: number
          uom?: string
          yarn_lot_id?: number | null
        }
        Update: {
          cgst_amount?: number
          costing_id?: number | null
          description?: string
          discount_amount?: number
          discount_pct?: number
          fabric_purchase_id?: number | null
          fabric_quality_id?: number | null
          fabric_stock_id?: number | null
          gst_rate_pct?: number
          hsn_sac?: string | null
          id?: number
          igst_amount?: number
          invoice_id?: number
          jobwork_cost_per_m?: number | null
          original_line_id?: number | null
          quantity?: number
          rate?: number
          resale_lot_id?: number | null
          sgst_amount?: number
          so_line_id?: number | null
          taxable_amount?: number
          total_amount?: number
          uom?: string
          yarn_lot_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_line_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "costing_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "v_costing_two_cost"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "v_quality_margin"
            referencedColumns: ["costing_id"]
          },
          {
            foreignKeyName: "invoice_line_fabric_purchase_id_fkey"
            columns: ["fabric_purchase_id"]
            isOneToOne: false
            referencedRelation: "fabric_purchase"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_fabric_quality_id_fkey"
            columns: ["fabric_quality_id"]
            isOneToOne: false
            referencedRelation: "fabric_quality"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_fabric_stock_id_fkey"
            columns: ["fabric_stock_id"]
            isOneToOne: false
            referencedRelation: "fabric_stock"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoice"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_invoice_delivery_status"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "invoice_line_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_sales_register"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "invoice_line_original_line_id_fkey"
            columns: ["original_line_id"]
            isOneToOne: false
            referencedRelation: "invoice_line"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_resale_lot_id_fkey"
            columns: ["resale_lot_id"]
            isOneToOne: false
            referencedRelation: "resale_lot"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_so_line_id_fkey"
            columns: ["so_line_id"]
            isOneToOne: false
            referencedRelation: "sales_order_line"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_yarn_lot_id_fkey"
            columns: ["yarn_lot_id"]
            isOneToOne: false
            referencedRelation: "yarn_lot"
            referencedColumns: ["id"]
          },
        ]
      }
      jobwork_bobbin_issue: {
        Row: {
          bobbin_id: number
          created_at: string
          created_by: string | null
          id: number
          issue_date: string
          jobwork_party_id: number
          notes: string | null
          original_pieces: number | null
          pieces_issued: number
          reference_no: string | null
          status: Database["public"]["Enums"]["record_status"]
          supplier_party_id: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          bobbin_id: number
          created_at?: string
          created_by?: string | null
          id?: number
          issue_date?: string
          jobwork_party_id: number
          notes?: string | null
          original_pieces?: number | null
          pieces_issued?: number
          reference_no?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          supplier_party_id?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          bobbin_id?: number
          created_at?: string
          created_by?: string | null
          id?: number
          issue_date?: string
          jobwork_party_id?: number
          notes?: string | null
          original_pieces?: number | null
          pieces_issued?: number
          reference_no?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          supplier_party_id?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jobwork_bobbin_issue_bobbin_id_fkey"
            columns: ["bobbin_id"]
            isOneToOne: false
            referencedRelation: "bobbin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobwork_bobbin_issue_bobbin_id_fkey"
            columns: ["bobbin_id"]
            isOneToOne: false
            referencedRelation: "v_bobbin_consumption"
            referencedColumns: ["bobbin_id"]
          },
          {
            foreignKeyName: "jobwork_bobbin_issue_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobwork_bobbin_issue_jobwork_party_id_fkey"
            columns: ["jobwork_party_id"]
            isOneToOne: false
            referencedRelation: "jobwork_party"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobwork_bobbin_issue_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
        ]
      }
      jobwork_order: {
        Row: {
          bobbin_pcs_received: number
          costing_id: number
          created_at: string
          created_by: string | null
          customer_id: number
          delivered_date: string | null
          delivered_metres: number
          expected_metres: number
          id: number
          jw_number: string
          labour_rate_per_m: number
          notes: string | null
          porvai_kg_received: number
          promised_date: string | null
          received_date: string
          status: string
          updated_at: string
          updated_by: string | null
          warp_kg_received: number
          weft_kg_received: number
        }
        Insert: {
          bobbin_pcs_received?: number
          costing_id: number
          created_at?: string
          created_by?: string | null
          customer_id: number
          delivered_date?: string | null
          delivered_metres?: number
          expected_metres: number
          id?: number
          jw_number: string
          labour_rate_per_m: number
          notes?: string | null
          porvai_kg_received?: number
          promised_date?: string | null
          received_date: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          warp_kg_received?: number
          weft_kg_received?: number
        }
        Update: {
          bobbin_pcs_received?: number
          costing_id?: number
          created_at?: string
          created_by?: string | null
          customer_id?: number
          delivered_date?: string | null
          delivered_metres?: number
          expected_metres?: number
          id?: number
          jw_number?: string
          labour_rate_per_m?: number
          notes?: string | null
          porvai_kg_received?: number
          promised_date?: string | null
          received_date?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          warp_kg_received?: number
          weft_kg_received?: number
        }
        Relationships: [
          {
            foreignKeyName: "jobwork_order_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "costing_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobwork_order_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "v_costing_two_cost"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobwork_order_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "v_quality_margin"
            referencedColumns: ["costing_id"]
          },
          {
            foreignKeyName: "jobwork_order_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobwork_order_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobwork_order_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_ageing"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "jobwork_order_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_outstanding"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "jobwork_order_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
        ]
      }
      jobwork_party: {
        Row: {
          billing_address: string
          city: string | null
          code: string
          contact_person: string | null
          created_at: string
          created_by: string | null
          credit_limit: number
          email: string | null
          gstin: string | null
          id: number
          kind: string
          ledger_id: number | null
          name: string
          notes: string | null
          pan: string | null
          payment_terms_days: number
          phone: string | null
          pincode: string | null
          shipping_address: string | null
          state: string | null
          status: Database["public"]["Enums"]["record_status"]
          updated_at: string
          updated_by: string | null
          whatsapp: string | null
        }
        Insert: {
          billing_address?: string
          city?: string | null
          code: string
          contact_person?: string | null
          created_at?: string
          created_by?: string | null
          credit_limit?: number
          email?: string | null
          gstin?: string | null
          id?: number
          kind?: string
          ledger_id?: number | null
          name: string
          notes?: string | null
          pan?: string | null
          payment_terms_days?: number
          phone?: string | null
          pincode?: string | null
          shipping_address?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
          updated_by?: string | null
          whatsapp?: string | null
        }
        Update: {
          billing_address?: string
          city?: string | null
          code?: string
          contact_person?: string | null
          created_at?: string
          created_by?: string | null
          credit_limit?: number
          email?: string | null
          gstin?: string | null
          id?: number
          kind?: string
          ledger_id?: number | null
          name?: string
          notes?: string | null
          pan?: string | null
          payment_terms_days?: number
          phone?: string | null
          pincode?: string | null
          shipping_address?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
          updated_by?: string | null
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jobwork_party_ledger_id_fkey"
            columns: ["ledger_id"]
            isOneToOne: false
            referencedRelation: "ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobwork_party_ledger_id_fkey"
            columns: ["ledger_id"]
            isOneToOne: false
            referencedRelation: "v_sizing_spend_by_vendor"
            referencedColumns: ["vendor_id"]
          },
        ]
      }
      jobwork_warp_beam: {
        Row: {
          beam_count: number
          created_at: string
          created_by: string | null
          fabric_quality_id: number | null
          given_date: string
          id: number
          jobwork_party_id: number
          notes: string | null
          original_metres: number | null
          pavu_id: number | null
          pavu_ids: Json | null
          reference_no: string | null
          sizing_job_id: number | null
          sizing_set_no: string | null
          status: Database["public"]["Enums"]["record_status"]
          supplier_party_id: number | null
          tape_length_m: number | null
          total_ends: number | null
          total_metres: number | null
          updated_at: string
          updated_by: string | null
          warp_count_id: number | null
        }
        Insert: {
          beam_count?: number
          created_at?: string
          created_by?: string | null
          fabric_quality_id?: number | null
          given_date?: string
          id?: number
          jobwork_party_id: number
          notes?: string | null
          original_metres?: number | null
          pavu_id?: number | null
          pavu_ids?: Json | null
          reference_no?: string | null
          sizing_job_id?: number | null
          sizing_set_no?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          supplier_party_id?: number | null
          tape_length_m?: number | null
          total_ends?: number | null
          total_metres?: number | null
          updated_at?: string
          updated_by?: string | null
          warp_count_id?: number | null
        }
        Update: {
          beam_count?: number
          created_at?: string
          created_by?: string | null
          fabric_quality_id?: number | null
          given_date?: string
          id?: number
          jobwork_party_id?: number
          notes?: string | null
          original_metres?: number | null
          pavu_id?: number | null
          pavu_ids?: Json | null
          reference_no?: string | null
          sizing_job_id?: number | null
          sizing_set_no?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          supplier_party_id?: number | null
          tape_length_m?: number | null
          total_ends?: number | null
          total_metres?: number | null
          updated_at?: string
          updated_by?: string | null
          warp_count_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "jobwork_warp_beam_fabric_quality_id_fkey"
            columns: ["fabric_quality_id"]
            isOneToOne: false
            referencedRelation: "fabric_quality"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobwork_warp_beam_jobwork_party_id_fkey"
            columns: ["jobwork_party_id"]
            isOneToOne: false
            referencedRelation: "jobwork_party"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobwork_warp_beam_pavu_id_fkey"
            columns: ["pavu_id"]
            isOneToOne: false
            referencedRelation: "pavu"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobwork_warp_beam_sizing_job_id_fkey"
            columns: ["sizing_job_id"]
            isOneToOne: false
            referencedRelation: "sizing_job"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobwork_warp_beam_sizing_job_id_fkey"
            columns: ["sizing_job_id"]
            isOneToOne: false
            referencedRelation: "v_sizing_job_balance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobwork_warp_beam_supplier_party_id_fkey"
            columns: ["supplier_party_id"]
            isOneToOne: false
            referencedRelation: "party"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobwork_warp_beam_supplier_party_id_fkey"
            columns: ["supplier_party_id"]
            isOneToOne: false
            referencedRelation: "v_jobwork_payment_status"
            referencedColumns: ["party_id"]
          },
          {
            foreignKeyName: "jobwork_warp_beam_warp_count_id_fkey"
            columns: ["warp_count_id"]
            isOneToOne: false
            referencedRelation: "v_stock_on_hand"
            referencedColumns: ["yarn_count_id"]
          },
          {
            foreignKeyName: "jobwork_warp_beam_warp_count_id_fkey"
            columns: ["warp_count_id"]
            isOneToOne: false
            referencedRelation: "v_yarn_cover_dashboard"
            referencedColumns: ["yarn_count_id"]
          },
          {
            foreignKeyName: "jobwork_warp_beam_warp_count_id_fkey"
            columns: ["warp_count_id"]
            isOneToOne: false
            referencedRelation: "yarn_count"
            referencedColumns: ["id"]
          },
        ]
      }
      jobwork_warp_yarn: {
        Row: {
          created_at: string
          created_by: string | null
          ends_id: number | null
          fabric_quality_id: number | null
          given_date: string
          id: number
          jobwork_party_id: number
          notes: string | null
          reference_no: string | null
          sizing_rate_per_kg: number | null
          status: Database["public"]["Enums"]["record_status"]
          supplier_party_id: number | null
          total_cost: number | null
          total_kg: number | null
          updated_at: string
          updated_by: string | null
          warp_count_id: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          ends_id?: number | null
          fabric_quality_id?: number | null
          given_date?: string
          id?: number
          jobwork_party_id: number
          notes?: string | null
          reference_no?: string | null
          sizing_rate_per_kg?: number | null
          status?: Database["public"]["Enums"]["record_status"]
          supplier_party_id?: number | null
          total_cost?: number | null
          total_kg?: number | null
          updated_at?: string
          updated_by?: string | null
          warp_count_id?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          ends_id?: number | null
          fabric_quality_id?: number | null
          given_date?: string
          id?: number
          jobwork_party_id?: number
          notes?: string | null
          reference_no?: string | null
          sizing_rate_per_kg?: number | null
          status?: Database["public"]["Enums"]["record_status"]
          supplier_party_id?: number | null
          total_cost?: number | null
          total_kg?: number | null
          updated_at?: string
          updated_by?: string | null
          warp_count_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "jobwork_warp_yarn_ends_id_fkey"
            columns: ["ends_id"]
            isOneToOne: false
            referencedRelation: "ends_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobwork_warp_yarn_fabric_quality_id_fkey"
            columns: ["fabric_quality_id"]
            isOneToOne: false
            referencedRelation: "fabric_quality"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobwork_warp_yarn_jobwork_party_id_fkey"
            columns: ["jobwork_party_id"]
            isOneToOne: false
            referencedRelation: "jobwork_party"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobwork_warp_yarn_supplier_party_id_fkey"
            columns: ["supplier_party_id"]
            isOneToOne: false
            referencedRelation: "party"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobwork_warp_yarn_supplier_party_id_fkey"
            columns: ["supplier_party_id"]
            isOneToOne: false
            referencedRelation: "v_jobwork_payment_status"
            referencedColumns: ["party_id"]
          },
          {
            foreignKeyName: "jobwork_warp_yarn_warp_count_id_fkey"
            columns: ["warp_count_id"]
            isOneToOne: false
            referencedRelation: "v_stock_on_hand"
            referencedColumns: ["yarn_count_id"]
          },
          {
            foreignKeyName: "jobwork_warp_yarn_warp_count_id_fkey"
            columns: ["warp_count_id"]
            isOneToOne: false
            referencedRelation: "v_yarn_cover_dashboard"
            referencedColumns: ["yarn_count_id"]
          },
          {
            foreignKeyName: "jobwork_warp_yarn_warp_count_id_fkey"
            columns: ["warp_count_id"]
            isOneToOne: false
            referencedRelation: "yarn_count"
            referencedColumns: ["id"]
          },
        ]
      }
      jobwork_weft_bag: {
        Row: {
          bag_count: number | null
          created_at: string
          created_by: string | null
          given_date: string
          id: number
          jobwork_party_id: number
          notes: string | null
          original_kg: number | null
          reference_no: string | null
          status: Database["public"]["Enums"]["record_status"]
          supplier_party_id: number | null
          total_kg: number | null
          updated_at: string
          updated_by: string | null
          yarn_count_id: number | null
        }
        Insert: {
          bag_count?: number | null
          created_at?: string
          created_by?: string | null
          given_date?: string
          id?: number
          jobwork_party_id: number
          notes?: string | null
          original_kg?: number | null
          reference_no?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          supplier_party_id?: number | null
          total_kg?: number | null
          updated_at?: string
          updated_by?: string | null
          yarn_count_id?: number | null
        }
        Update: {
          bag_count?: number | null
          created_at?: string
          created_by?: string | null
          given_date?: string
          id?: number
          jobwork_party_id?: number
          notes?: string | null
          original_kg?: number | null
          reference_no?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          supplier_party_id?: number | null
          total_kg?: number | null
          updated_at?: string
          updated_by?: string | null
          yarn_count_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "jobwork_weft_bag_jobwork_party_id_fkey"
            columns: ["jobwork_party_id"]
            isOneToOne: false
            referencedRelation: "jobwork_party"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobwork_weft_bag_supplier_party_id_fkey"
            columns: ["supplier_party_id"]
            isOneToOne: false
            referencedRelation: "party"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobwork_weft_bag_supplier_party_id_fkey"
            columns: ["supplier_party_id"]
            isOneToOne: false
            referencedRelation: "v_jobwork_payment_status"
            referencedColumns: ["party_id"]
          },
          {
            foreignKeyName: "jobwork_weft_bag_yarn_count_id_fkey"
            columns: ["yarn_count_id"]
            isOneToOne: false
            referencedRelation: "v_stock_on_hand"
            referencedColumns: ["yarn_count_id"]
          },
          {
            foreignKeyName: "jobwork_weft_bag_yarn_count_id_fkey"
            columns: ["yarn_count_id"]
            isOneToOne: false
            referencedRelation: "v_yarn_cover_dashboard"
            referencedColumns: ["yarn_count_id"]
          },
          {
            foreignKeyName: "jobwork_weft_bag_yarn_count_id_fkey"
            columns: ["yarn_count_id"]
            isOneToOne: false
            referencedRelation: "yarn_count"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger: {
        Row: {
          active: boolean
          address1: string | null
          address2: string | null
          address3: string | null
          address4: string | null
          area: string | null
          bank_account_no: string | null
          bank_branch: string | null
          bank_ifsc: string | null
          bank_name: string | null
          brokerage_per_bag: number | null
          code: string
          created_at: string
          created_by: string | null
          email: string | null
          group_id: number
          gstin: string | null
          gstin_verified_at: string | null
          id: number
          name: string
          notes: string | null
          opening_amount: number
          opening_date: string | null
          opening_dr_cr: string | null
          pan_no: string | null
          phone: string | null
          type_id: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          address1?: string | null
          address2?: string | null
          address3?: string | null
          address4?: string | null
          area?: string | null
          bank_account_no?: string | null
          bank_branch?: string | null
          bank_ifsc?: string | null
          bank_name?: string | null
          brokerage_per_bag?: number | null
          code: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          group_id: number
          gstin?: string | null
          gstin_verified_at?: string | null
          id?: number
          name: string
          notes?: string | null
          opening_amount?: number
          opening_date?: string | null
          opening_dr_cr?: string | null
          pan_no?: string | null
          phone?: string | null
          type_id: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          address1?: string | null
          address2?: string | null
          address3?: string | null
          address4?: string | null
          area?: string | null
          bank_account_no?: string | null
          bank_branch?: string | null
          bank_ifsc?: string | null
          bank_name?: string | null
          brokerage_per_bag?: number | null
          code?: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          group_id?: number
          gstin?: string | null
          gstin_verified_at?: string | null
          id?: number
          name?: string
          notes?: string | null
          opening_amount?: number
          opening_date?: string | null
          opening_dr_cr?: string | null
          pan_no?: string | null
          phone?: string | null
          type_id?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ledger_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "ledger_group"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_type_id_fkey"
            columns: ["type_id"]
            isOneToOne: false
            referencedRelation: "ledger_type"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_group: {
        Row: {
          active: boolean
          code: string
          created_at: string
          created_by: string | null
          id: number
          name: string
          notes: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          created_by?: string | null
          id?: number
          name: string
          notes?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          created_by?: string | null
          id?: number
          name?: string
          notes?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ledger_group_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_group_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_type: {
        Row: {
          active: boolean
          code: string
          created_at: string
          created_by: string | null
          id: number
          name: string
          notes: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          created_by?: string | null
          id?: number
          name: string
          notes?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          created_by?: string | null
          id?: number
          name?: string
          notes?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ledger_type_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_type_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
        ]
      }
      loom: {
        Row: {
          default_rate_per_m: number | null
          fabric_quality_id: number | null
          id: number
          idle_since: string | null
          loom_code: string
          loom_type: string
          notes: string | null
          shed_no: number | null
          status: string
          width_in: number | null
        }
        Insert: {
          default_rate_per_m?: number | null
          fabric_quality_id?: number | null
          id?: number
          idle_since?: string | null
          loom_code: string
          loom_type: string
          notes?: string | null
          shed_no?: number | null
          status?: string
          width_in?: number | null
        }
        Update: {
          default_rate_per_m?: number | null
          fabric_quality_id?: number | null
          id?: number
          idle_since?: string | null
          loom_code?: string
          loom_type?: string
          notes?: string | null
          shed_no?: number | null
          status?: string
          width_in?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "loom_fabric_quality_id_fkey"
            columns: ["fabric_quality_id"]
            isOneToOne: false
            referencedRelation: "fabric_quality"
            referencedColumns: ["id"]
          },
        ]
      }
      notification: {
        Row: {
          body: string | null
          category: string | null
          created_at: string
          id: number
          is_read: boolean
          link: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          category?: string | null
          created_at?: string
          id?: number
          is_read?: boolean
          link?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          category?: string | null
          created_at?: string
          id?: number
          is_read?: boolean
          link?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_clear: {
        Row: {
          cleared_at: string
          user_id: string
        }
        Insert: {
          cleared_at?: string
          user_id: string
        }
        Update: {
          cleared_at?: string
          user_id?: string
        }
        Relationships: []
      }
      opening_stock: {
        Row: {
          bobbin_id: number | null
          bucket: string
          created_at: string
          created_by: string | null
          ends_per_bobbin: number | null
          fabric_quality_id: number | null
          id: number
          mode: string
          notes: string | null
          open_date: string
          quantity: number
          reference_no: string | null
          status: string
          unit: string
          updated_at: string
          updated_by: string | null
          warp_ends: number | null
          yarn_count_id: number | null
        }
        Insert: {
          bobbin_id?: number | null
          bucket: string
          created_at?: string
          created_by?: string | null
          ends_per_bobbin?: number | null
          fabric_quality_id?: number | null
          id?: number
          mode?: string
          notes?: string | null
          open_date?: string
          quantity?: number
          reference_no?: string | null
          status?: string
          unit: string
          updated_at?: string
          updated_by?: string | null
          warp_ends?: number | null
          yarn_count_id?: number | null
        }
        Update: {
          bobbin_id?: number | null
          bucket?: string
          created_at?: string
          created_by?: string | null
          ends_per_bobbin?: number | null
          fabric_quality_id?: number | null
          id?: number
          mode?: string
          notes?: string | null
          open_date?: string
          quantity?: number
          reference_no?: string | null
          status?: string
          unit?: string
          updated_at?: string
          updated_by?: string | null
          warp_ends?: number | null
          yarn_count_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "opening_stock_bobbin_id_fkey"
            columns: ["bobbin_id"]
            isOneToOne: false
            referencedRelation: "bobbin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opening_stock_bobbin_id_fkey"
            columns: ["bobbin_id"]
            isOneToOne: false
            referencedRelation: "v_bobbin_consumption"
            referencedColumns: ["bobbin_id"]
          },
          {
            foreignKeyName: "opening_stock_fabric_quality_id_fkey"
            columns: ["fabric_quality_id"]
            isOneToOne: false
            referencedRelation: "fabric_quality"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opening_stock_yarn_count_id_fkey"
            columns: ["yarn_count_id"]
            isOneToOne: false
            referencedRelation: "v_stock_on_hand"
            referencedColumns: ["yarn_count_id"]
          },
          {
            foreignKeyName: "opening_stock_yarn_count_id_fkey"
            columns: ["yarn_count_id"]
            isOneToOne: false
            referencedRelation: "v_yarn_cover_dashboard"
            referencedColumns: ["yarn_count_id"]
          },
          {
            foreignKeyName: "opening_stock_yarn_count_id_fkey"
            columns: ["yarn_count_id"]
            isOneToOne: false
            referencedRelation: "yarn_count"
            referencedColumns: ["id"]
          },
        ]
      }
      outsource_order: {
        Row: {
          bobbin_1_id: number | null
          bobbin_1_pcs_issued: number
          bobbin_pcs_returned: number
          costing_id: number
          created_at: string
          created_by: string | null
          delivered_date: string | null
          delivered_metres: number
          expected_metres: number
          id: number
          issued_date: string
          ledger_id: number | null
          notes: string | null
          ow_number: string
          pick_paise_agreed: number
          porvai_lot_id: number | null
          promised_date: string | null
          so_line_id: number | null
          status: string
          updated_at: string
          updated_by: string | null
          warp_lot_id: number | null
          weft_lot_id: number | null
        }
        Insert: {
          bobbin_1_id?: number | null
          bobbin_1_pcs_issued?: number
          bobbin_pcs_returned?: number
          costing_id: number
          created_at?: string
          created_by?: string | null
          delivered_date?: string | null
          delivered_metres?: number
          expected_metres: number
          id?: number
          issued_date: string
          ledger_id?: number | null
          notes?: string | null
          ow_number: string
          pick_paise_agreed: number
          porvai_lot_id?: number | null
          promised_date?: string | null
          so_line_id?: number | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          warp_lot_id?: number | null
          weft_lot_id?: number | null
        }
        Update: {
          bobbin_1_id?: number | null
          bobbin_1_pcs_issued?: number
          bobbin_pcs_returned?: number
          costing_id?: number
          created_at?: string
          created_by?: string | null
          delivered_date?: string | null
          delivered_metres?: number
          expected_metres?: number
          id?: number
          issued_date?: string
          ledger_id?: number | null
          notes?: string | null
          ow_number?: string
          pick_paise_agreed?: number
          porvai_lot_id?: number | null
          promised_date?: string | null
          so_line_id?: number | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          warp_lot_id?: number | null
          weft_lot_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "outsource_order_bobbin_1_id_fkey"
            columns: ["bobbin_1_id"]
            isOneToOne: false
            referencedRelation: "bobbin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outsource_order_bobbin_1_id_fkey"
            columns: ["bobbin_1_id"]
            isOneToOne: false
            referencedRelation: "v_bobbin_consumption"
            referencedColumns: ["bobbin_id"]
          },
          {
            foreignKeyName: "outsource_order_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "costing_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outsource_order_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "v_costing_two_cost"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outsource_order_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "v_quality_margin"
            referencedColumns: ["costing_id"]
          },
          {
            foreignKeyName: "outsource_order_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outsource_order_ledger_id_fkey"
            columns: ["ledger_id"]
            isOneToOne: false
            referencedRelation: "ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outsource_order_ledger_id_fkey"
            columns: ["ledger_id"]
            isOneToOne: false
            referencedRelation: "v_sizing_spend_by_vendor"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "outsource_order_porvai_lot_id_fkey"
            columns: ["porvai_lot_id"]
            isOneToOne: false
            referencedRelation: "yarn_lot"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outsource_order_so_line_id_fkey"
            columns: ["so_line_id"]
            isOneToOne: false
            referencedRelation: "sales_order_line"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outsource_order_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outsource_order_warp_lot_id_fkey"
            columns: ["warp_lot_id"]
            isOneToOne: false
            referencedRelation: "yarn_lot"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outsource_order_weft_lot_id_fkey"
            columns: ["weft_lot_id"]
            isOneToOne: false
            referencedRelation: "yarn_lot"
            referencedColumns: ["id"]
          },
        ]
      }
      party: {
        Row: {
          address1: string | null
          address2: string | null
          address3: string | null
          address4: string | null
          billing_address: string
          city: string | null
          code: string
          contact_person: string | null
          created_at: string
          created_by: string | null
          credit_limit: number
          email: string | null
          gstin: string | null
          gstin_verified_at: string | null
          id: number
          is_vip: boolean
          ledger_id: number | null
          name: string
          notes: string | null
          pan: string | null
          party_type_id: number | null
          party_type_ids: number[]
          payment_terms_days: number
          phone: string | null
          pincode: string | null
          shipping_address: string | null
          state: string | null
          state_code: string | null
          status: Database["public"]["Enums"]["record_status"]
          updated_at: string
          updated_by: string | null
          whatsapp: string | null
        }
        Insert: {
          address1?: string | null
          address2?: string | null
          address3?: string | null
          address4?: string | null
          billing_address?: string
          city?: string | null
          code: string
          contact_person?: string | null
          created_at?: string
          created_by?: string | null
          credit_limit?: number
          email?: string | null
          gstin?: string | null
          gstin_verified_at?: string | null
          id?: number
          is_vip?: boolean
          ledger_id?: number | null
          name: string
          notes?: string | null
          pan?: string | null
          party_type_id?: number | null
          party_type_ids?: number[]
          payment_terms_days?: number
          phone?: string | null
          pincode?: string | null
          shipping_address?: string | null
          state?: string | null
          state_code?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
          updated_by?: string | null
          whatsapp?: string | null
        }
        Update: {
          address1?: string | null
          address2?: string | null
          address3?: string | null
          address4?: string | null
          billing_address?: string
          city?: string | null
          code?: string
          contact_person?: string | null
          created_at?: string
          created_by?: string | null
          credit_limit?: number
          email?: string | null
          gstin?: string | null
          gstin_verified_at?: string | null
          id?: number
          is_vip?: boolean
          ledger_id?: number | null
          name?: string
          notes?: string | null
          pan?: string | null
          party_type_id?: number | null
          party_type_ids?: number[]
          payment_terms_days?: number
          phone?: string | null
          pincode?: string | null
          shipping_address?: string | null
          state?: string | null
          state_code?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
          updated_by?: string | null
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "party_ledger_id_fkey"
            columns: ["ledger_id"]
            isOneToOne: false
            referencedRelation: "ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "party_ledger_id_fkey"
            columns: ["ledger_id"]
            isOneToOne: false
            referencedRelation: "v_sizing_spend_by_vendor"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "party_party_type_id_fkey"
            columns: ["party_type_id"]
            isOneToOne: false
            referencedRelation: "party_type_master"
            referencedColumns: ["id"]
          },
        ]
      }
      party_opening_ledger: {
        Row: {
          amount: number
          amount_paid: number
          balance: number | null
          created_at: string
          created_by: string | null
          direction: string
          id: number
          invoice_date: string
          invoice_no: string
          notes: string | null
          party_id: number
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount: number
          amount_paid?: number
          balance?: number | null
          created_at?: string
          created_by?: string | null
          direction: string
          id?: number
          invoice_date: string
          invoice_no: string
          notes?: string | null
          party_id: number
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount?: number
          amount_paid?: number
          balance?: number | null
          created_at?: string
          created_by?: string | null
          direction?: string
          id?: number
          invoice_date?: string
          invoice_no?: string
          notes?: string | null
          party_id?: number
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "party_opening_ledger_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "party"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "party_opening_ledger_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "v_jobwork_payment_status"
            referencedColumns: ["party_id"]
          },
        ]
      }
      party_type_master: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: number
          ledger_group_id: number | null
          ledger_type_id: number | null
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: number
          ledger_group_id?: number | null
          ledger_type_id?: number | null
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: number
          ledger_group_id?: number | null
          ledger_type_id?: number | null
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "party_type_master_ledger_group_id_fkey"
            columns: ["ledger_group_id"]
            isOneToOne: false
            referencedRelation: "ledger_group"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "party_type_master_ledger_type_id_fkey"
            columns: ["ledger_type_id"]
            isOneToOne: false
            referencedRelation: "ledger_type"
            referencedColumns: ["id"]
          },
        ]
      }
      pavu: {
        Row: {
          beam_no: string
          created_at: string
          created_by: string | null
          ends: number
          id: number
          jobwork_ledger_id: number | null
          meters: number
          notes: string | null
          outsource_ledger_id: number | null
          pavu_code: string
          production_mode: Database["public"]["Enums"]["pavu_production_mode"]
          sizing_job_id: number | null
          sizing_set_no: string | null
          status: Database["public"]["Enums"]["pavu_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          beam_no: string
          created_at?: string
          created_by?: string | null
          ends: number
          id?: number
          jobwork_ledger_id?: number | null
          meters: number
          notes?: string | null
          outsource_ledger_id?: number | null
          pavu_code: string
          production_mode?: Database["public"]["Enums"]["pavu_production_mode"]
          sizing_job_id?: number | null
          sizing_set_no?: string | null
          status?: Database["public"]["Enums"]["pavu_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          beam_no?: string
          created_at?: string
          created_by?: string | null
          ends?: number
          id?: number
          jobwork_ledger_id?: number | null
          meters?: number
          notes?: string | null
          outsource_ledger_id?: number | null
          pavu_code?: string
          production_mode?: Database["public"]["Enums"]["pavu_production_mode"]
          sizing_job_id?: number | null
          sizing_set_no?: string | null
          status?: Database["public"]["Enums"]["pavu_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pavu_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pavu_jobwork_ledger_id_fkey"
            columns: ["jobwork_ledger_id"]
            isOneToOne: false
            referencedRelation: "ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pavu_jobwork_ledger_id_fkey"
            columns: ["jobwork_ledger_id"]
            isOneToOne: false
            referencedRelation: "v_sizing_spend_by_vendor"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "pavu_outsource_ledger_id_fkey"
            columns: ["outsource_ledger_id"]
            isOneToOne: false
            referencedRelation: "ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pavu_outsource_ledger_id_fkey"
            columns: ["outsource_ledger_id"]
            isOneToOne: false
            referencedRelation: "v_sizing_spend_by_vendor"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "pavu_sizing_job_id_fkey"
            columns: ["sizing_job_id"]
            isOneToOne: false
            referencedRelation: "sizing_job"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pavu_sizing_job_id_fkey"
            columns: ["sizing_job_id"]
            isOneToOne: false
            referencedRelation: "v_sizing_job_balance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pavu_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
        ]
      }
      pavu_assign: {
        Row: {
          assigned_date: string
          costing_id: number | null
          created_at: string
          created_by: string | null
          end_date: string | null
          id: number
          loom_id: number
          metres_produced: number
          metres_start_date: string | null
          notes: string | null
          pavu_id: number
          start_date: string | null
          status: Database["public"]["Enums"]["pavu_assign_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          assigned_date?: string
          costing_id?: number | null
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          id?: number
          loom_id: number
          metres_produced?: number
          metres_start_date?: string | null
          notes?: string | null
          pavu_id: number
          start_date?: string | null
          status?: Database["public"]["Enums"]["pavu_assign_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          assigned_date?: string
          costing_id?: number | null
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          id?: number
          loom_id?: number
          metres_produced?: number
          metres_start_date?: string | null
          notes?: string | null
          pavu_id?: number
          start_date?: string | null
          status?: Database["public"]["Enums"]["pavu_assign_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pavu_assign_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "costing_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pavu_assign_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "v_costing_two_cost"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pavu_assign_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "v_quality_margin"
            referencedColumns: ["costing_id"]
          },
          {
            foreignKeyName: "pavu_assign_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pavu_assign_loom_id_fkey"
            columns: ["loom_id"]
            isOneToOne: false
            referencedRelation: "loom"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pavu_assign_loom_id_fkey"
            columns: ["loom_id"]
            isOneToOne: false
            referencedRelation: "v_loom_shift_utilisation"
            referencedColumns: ["loom_id"]
          },
          {
            foreignKeyName: "pavu_assign_loom_id_fkey"
            columns: ["loom_id"]
            isOneToOne: false
            referencedRelation: "v_loom_utilisation"
            referencedColumns: ["loom_id"]
          },
          {
            foreignKeyName: "pavu_assign_pavu_id_fkey"
            columns: ["pavu_id"]
            isOneToOne: false
            referencedRelation: "pavu"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pavu_assign_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
        ]
      }
      payment: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          customer_id: number | null
          direction: Database["public"]["Enums"]["payment_direction"]
          fabric_purchase_id: number | null
          id: number
          invoice_id: number | null
          ledger_id: number | null
          mill_id: number | null
          mode: string
          mode_ledger_id: number | null
          notes: string | null
          party_id: number | null
          payment_date: string
          payment_no: string
          purchase_id: number | null
          reference: string | null
          sizing_job_id: number | null
          status: Database["public"]["Enums"]["record_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          customer_id?: number | null
          direction: Database["public"]["Enums"]["payment_direction"]
          fabric_purchase_id?: number | null
          id?: number
          invoice_id?: number | null
          ledger_id?: number | null
          mill_id?: number | null
          mode: string
          mode_ledger_id?: number | null
          notes?: string | null
          party_id?: number | null
          payment_date?: string
          payment_no: string
          purchase_id?: number | null
          reference?: string | null
          sizing_job_id?: number | null
          status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          customer_id?: number | null
          direction?: Database["public"]["Enums"]["payment_direction"]
          fabric_purchase_id?: number | null
          id?: number
          invoice_id?: number | null
          ledger_id?: number | null
          mill_id?: number | null
          mode?: string
          mode_ledger_id?: number | null
          notes?: string | null
          party_id?: number | null
          payment_date?: string
          payment_no?: string
          purchase_id?: number | null
          reference?: string | null
          sizing_job_id?: number | null
          status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_ageing"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "payment_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_outstanding"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "payment_fabric_purchase_id_fkey"
            columns: ["fabric_purchase_id"]
            isOneToOne: false
            referencedRelation: "fabric_purchase"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoice"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_invoice_delivery_status"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "payment_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_sales_register"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "payment_ledger_id_fkey"
            columns: ["ledger_id"]
            isOneToOne: false
            referencedRelation: "ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_ledger_id_fkey"
            columns: ["ledger_id"]
            isOneToOne: false
            referencedRelation: "v_sizing_spend_by_vendor"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "payment_mode_ledger_id_fkey"
            columns: ["mode_ledger_id"]
            isOneToOne: false
            referencedRelation: "ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_mode_ledger_id_fkey"
            columns: ["mode_ledger_id"]
            isOneToOne: false
            referencedRelation: "v_sizing_spend_by_vendor"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "payment_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "party"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "v_jobwork_payment_status"
            referencedColumns: ["party_id"]
          },
          {
            foreignKeyName: "payment_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "yarn_purchase"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_sizing_job_id_fkey"
            columns: ["sizing_job_id"]
            isOneToOne: false
            referencedRelation: "sizing_job"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_sizing_job_id_fkey"
            columns: ["sizing_job_id"]
            isOneToOne: false
            referencedRelation: "v_sizing_job_balance"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_agent_allocation: {
        Row: {
          agent_commission_id: number
          amount: number
          created_at: string
          id: number
          payment_id: number
        }
        Insert: {
          agent_commission_id: number
          amount: number
          created_at?: string
          id?: number
          payment_id: number
        }
        Update: {
          agent_commission_id?: number
          amount?: number
          created_at?: string
          id?: number
          payment_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "payment_agent_allocation_agent_commission_id_fkey"
            columns: ["agent_commission_id"]
            isOneToOne: false
            referencedRelation: "agent_commission"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_agent_allocation_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payment"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_allocation: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          id: number
          invoice_id: number
          payment_id: number
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          id?: number
          invoice_id: number
          payment_id: number
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: number
          invoice_id?: number
          payment_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "payment_allocation_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoice"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocation_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_invoice_delivery_status"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "payment_allocation_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_sales_register"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "payment_allocation_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payment"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_bobbin_allocation: {
        Row: {
          amount: number
          bobbin_purchase_id: number
          created_at: string
          created_by: string | null
          id: number
          payment_id: number
        }
        Insert: {
          amount: number
          bobbin_purchase_id: number
          created_at?: string
          created_by?: string | null
          id?: number
          payment_id: number
        }
        Update: {
          amount?: number
          bobbin_purchase_id?: number
          created_at?: string
          created_by?: string | null
          id?: number
          payment_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "payment_bobbin_allocation_bobbin_purchase_id_fkey"
            columns: ["bobbin_purchase_id"]
            isOneToOne: false
            referencedRelation: "bobbin_purchase"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_bobbin_allocation_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payment"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_fabric_allocation: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          fabric_purchase_id: number
          id: number
          payment_id: number
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          fabric_purchase_id: number
          id?: number
          payment_id: number
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          fabric_purchase_id?: number
          id?: number
          payment_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "payment_fabric_allocation_fabric_purchase_id_fkey"
            columns: ["fabric_purchase_id"]
            isOneToOne: false
            referencedRelation: "fabric_purchase"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_fabric_allocation_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payment"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_opening_allocation: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          id: number
          opening_ledger_id: number
          payment_id: number
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          id?: number
          opening_ledger_id: number
          payment_id: number
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: number
          opening_ledger_id?: number
          payment_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "payment_opening_allocation_opening_ledger_id_fkey"
            columns: ["opening_ledger_id"]
            isOneToOne: false
            referencedRelation: "party_opening_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_opening_allocation_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payment"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_sizing_allocation: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          id: number
          payment_id: number
          sizing_job_id: number
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          id?: number
          payment_id: number
          sizing_job_id: number
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: number
          payment_id?: number
          sizing_job_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "payment_sizing_allocation_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_sizing_allocation_sizing_job_id_fkey"
            columns: ["sizing_job_id"]
            isOneToOne: false
            referencedRelation: "sizing_job"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_sizing_allocation_sizing_job_id_fkey"
            columns: ["sizing_job_id"]
            isOneToOne: false
            referencedRelation: "v_sizing_job_balance"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_yarn_allocation: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          id: number
          payment_id: number
          yarn_lot_id: number
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          id?: number
          payment_id: number
          yarn_lot_id: number
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: number
          payment_id?: number
          yarn_lot_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "payment_yarn_allocation_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_yarn_allocation_yarn_lot_id_fkey"
            columns: ["yarn_lot_id"]
            isOneToOne: false
            referencedRelation: "yarn_lot"
            referencedColumns: ["id"]
          },
        ]
      }
      production_batch: {
        Row: {
          actual_bobbin_cost_per_m: number | null
          actual_overhead_per_m: number | null
          actual_pick_cost_per_m: number | null
          actual_porvai_cost_per_m: number | null
          actual_sizing_cost_per_m: number | null
          actual_sizing_rate_per_kg: number | null
          actual_true_cost_per_m: number | null
          actual_warp_cost_per_m: number | null
          actual_weft_cost_per_m: number | null
          batch_code: string
          bobbin_1_id: number | null
          bobbin_2_id: number | null
          bundles_detail: Json
          costing_id: number
          created_at: string
          created_by: string | null
          end_date: string | null
          entry_mode: string
          id: number
          loom_id: number | null
          notes: string | null
          outsource_order_id: number | null
          party_id: number | null
          pavu_assign_id: number | null
          porvai_lot_id: number | null
          produced_m: number
          production_mode: string
          rejected_m: number
          so_line_id: number | null
          start_date: string | null
          total_bundles: number | null
          total_pieces: number | null
          updated_at: string
          updated_by: string | null
          warp_lot_id: number | null
          weft_lot_id: number | null
        }
        Insert: {
          actual_bobbin_cost_per_m?: number | null
          actual_overhead_per_m?: number | null
          actual_pick_cost_per_m?: number | null
          actual_porvai_cost_per_m?: number | null
          actual_sizing_cost_per_m?: number | null
          actual_sizing_rate_per_kg?: number | null
          actual_true_cost_per_m?: number | null
          actual_warp_cost_per_m?: number | null
          actual_weft_cost_per_m?: number | null
          batch_code: string
          bobbin_1_id?: number | null
          bobbin_2_id?: number | null
          bundles_detail?: Json
          costing_id: number
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          entry_mode?: string
          id?: number
          loom_id?: number | null
          notes?: string | null
          outsource_order_id?: number | null
          party_id?: number | null
          pavu_assign_id?: number | null
          porvai_lot_id?: number | null
          produced_m?: number
          production_mode?: string
          rejected_m?: number
          so_line_id?: number | null
          start_date?: string | null
          total_bundles?: number | null
          total_pieces?: number | null
          updated_at?: string
          updated_by?: string | null
          warp_lot_id?: number | null
          weft_lot_id?: number | null
        }
        Update: {
          actual_bobbin_cost_per_m?: number | null
          actual_overhead_per_m?: number | null
          actual_pick_cost_per_m?: number | null
          actual_porvai_cost_per_m?: number | null
          actual_sizing_cost_per_m?: number | null
          actual_sizing_rate_per_kg?: number | null
          actual_true_cost_per_m?: number | null
          actual_warp_cost_per_m?: number | null
          actual_weft_cost_per_m?: number | null
          batch_code?: string
          bobbin_1_id?: number | null
          bobbin_2_id?: number | null
          bundles_detail?: Json
          costing_id?: number
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          entry_mode?: string
          id?: number
          loom_id?: number | null
          notes?: string | null
          outsource_order_id?: number | null
          party_id?: number | null
          pavu_assign_id?: number | null
          porvai_lot_id?: number | null
          produced_m?: number
          production_mode?: string
          rejected_m?: number
          so_line_id?: number | null
          start_date?: string | null
          total_bundles?: number | null
          total_pieces?: number | null
          updated_at?: string
          updated_by?: string | null
          warp_lot_id?: number | null
          weft_lot_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "production_batch_bobbin_1_id_fkey"
            columns: ["bobbin_1_id"]
            isOneToOne: false
            referencedRelation: "bobbin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_batch_bobbin_1_id_fkey"
            columns: ["bobbin_1_id"]
            isOneToOne: false
            referencedRelation: "v_bobbin_consumption"
            referencedColumns: ["bobbin_id"]
          },
          {
            foreignKeyName: "production_batch_bobbin_2_id_fkey"
            columns: ["bobbin_2_id"]
            isOneToOne: false
            referencedRelation: "bobbin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_batch_bobbin_2_id_fkey"
            columns: ["bobbin_2_id"]
            isOneToOne: false
            referencedRelation: "v_bobbin_consumption"
            referencedColumns: ["bobbin_id"]
          },
          {
            foreignKeyName: "production_batch_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "costing_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_batch_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "v_costing_two_cost"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_batch_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "v_quality_margin"
            referencedColumns: ["costing_id"]
          },
          {
            foreignKeyName: "production_batch_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_batch_loom_id_fkey"
            columns: ["loom_id"]
            isOneToOne: false
            referencedRelation: "loom"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_batch_loom_id_fkey"
            columns: ["loom_id"]
            isOneToOne: false
            referencedRelation: "v_loom_shift_utilisation"
            referencedColumns: ["loom_id"]
          },
          {
            foreignKeyName: "production_batch_loom_id_fkey"
            columns: ["loom_id"]
            isOneToOne: false
            referencedRelation: "v_loom_utilisation"
            referencedColumns: ["loom_id"]
          },
          {
            foreignKeyName: "production_batch_outsource_order_id_fkey"
            columns: ["outsource_order_id"]
            isOneToOne: false
            referencedRelation: "outsource_order"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_batch_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "party"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_batch_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "v_jobwork_payment_status"
            referencedColumns: ["party_id"]
          },
          {
            foreignKeyName: "production_batch_pavu_assign_id_fkey"
            columns: ["pavu_assign_id"]
            isOneToOne: false
            referencedRelation: "pavu_assign"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_batch_porvai_lot_id_fkey"
            columns: ["porvai_lot_id"]
            isOneToOne: false
            referencedRelation: "yarn_lot"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_batch_so_line_id_fkey"
            columns: ["so_line_id"]
            isOneToOne: false
            referencedRelation: "sales_order_line"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_batch_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_batch_warp_lot_id_fkey"
            columns: ["warp_lot_id"]
            isOneToOne: false
            referencedRelation: "yarn_lot"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_batch_weft_lot_id_fkey"
            columns: ["weft_lot_id"]
            isOneToOne: false
            referencedRelation: "yarn_lot"
            referencedColumns: ["id"]
          },
        ]
      }
      production_shift_log: {
        Row: {
          adjustment_metres: number
          created_at: string
          created_by: string | null
          fabric_quality_id: number | null
          id: number
          log_date: string
          loom_id: number
          notes: string | null
          rate_per_m: number | null
          shift: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          adjustment_metres?: number
          created_at?: string
          created_by?: string | null
          fabric_quality_id?: number | null
          id?: number
          log_date?: string
          loom_id: number
          notes?: string | null
          rate_per_m?: number | null
          shift: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          adjustment_metres?: number
          created_at?: string
          created_by?: string | null
          fabric_quality_id?: number | null
          id?: number
          log_date?: string
          loom_id?: number
          notes?: string | null
          rate_per_m?: number | null
          shift?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "production_shift_log_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_shift_log_fabric_quality_id_fkey"
            columns: ["fabric_quality_id"]
            isOneToOne: false
            referencedRelation: "fabric_quality"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_shift_log_loom_id_fkey"
            columns: ["loom_id"]
            isOneToOne: false
            referencedRelation: "loom"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_shift_log_loom_id_fkey"
            columns: ["loom_id"]
            isOneToOne: false
            referencedRelation: "v_loom_shift_utilisation"
            referencedColumns: ["loom_id"]
          },
          {
            foreignKeyName: "production_shift_log_loom_id_fkey"
            columns: ["loom_id"]
            isOneToOne: false
            referencedRelation: "v_loom_utilisation"
            referencedColumns: ["loom_id"]
          },
          {
            foreignKeyName: "production_shift_log_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
        ]
      }
      production_shift_log_weaver: {
        Row: {
          created_at: string
          employee_id: number
          id: number
          metres_woven: number
          position: number
          shift_log_id: number
        }
        Insert: {
          created_at?: string
          employee_id: number
          id?: number
          metres_woven?: number
          position?: number
          shift_log_id: number
        }
        Update: {
          created_at?: string
          employee_id?: number
          id?: number
          metres_woven?: number
          position?: number
          shift_log_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "production_shift_log_weaver_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employee"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_shift_log_weaver_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_attendance_detail"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "production_shift_log_weaver_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_attendance_monthly"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "production_shift_log_weaver_shift_log_id_fkey"
            columns: ["shift_log_id"]
            isOneToOne: false
            referencedRelation: "production_shift_log"
            referencedColumns: ["id"]
          },
        ]
      }
      resale_lot: {
        Row: {
          cost_per_m: number
          costing_id: number | null
          created_at: string
          created_by: string | null
          description: string | null
          id: number
          ledger_id: number | null
          metres_purchased: number
          metres_remaining: number
          notes: string | null
          received_date: string
          rl_number: string
        }
        Insert: {
          cost_per_m: number
          costing_id?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: number
          ledger_id?: number | null
          metres_purchased: number
          metres_remaining: number
          notes?: string | null
          received_date: string
          rl_number: string
        }
        Update: {
          cost_per_m?: number
          costing_id?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: number
          ledger_id?: number | null
          metres_purchased?: number
          metres_remaining?: number
          notes?: string | null
          received_date?: string
          rl_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "resale_lot_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "costing_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resale_lot_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "v_costing_two_cost"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resale_lot_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "v_quality_margin"
            referencedColumns: ["costing_id"]
          },
          {
            foreignKeyName: "resale_lot_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resale_lot_ledger_id_fkey"
            columns: ["ledger_id"]
            isOneToOne: false
            referencedRelation: "ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resale_lot_ledger_id_fkey"
            columns: ["ledger_id"]
            isOneToOne: false
            referencedRelation: "v_sizing_spend_by_vendor"
            referencedColumns: ["vendor_id"]
          },
        ]
      }
      sales_order: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          business_model: Database["public"]["Enums"]["business_model"]
          created_at: string
          created_by: string | null
          customer_id: number
          delivery_date: string | null
          gst_amount: number
          id: number
          notes: string | null
          order_date: string
          payment_date: string | null
          so_number: string
          status: Database["public"]["Enums"]["so_status"]
          subtotal: number
          total: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          business_model: Database["public"]["Enums"]["business_model"]
          created_at?: string
          created_by?: string | null
          customer_id: number
          delivery_date?: string | null
          gst_amount?: number
          id?: number
          notes?: string | null
          order_date?: string
          payment_date?: string | null
          so_number: string
          status?: Database["public"]["Enums"]["so_status"]
          subtotal?: number
          total?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          business_model?: Database["public"]["Enums"]["business_model"]
          created_at?: string
          created_by?: string | null
          customer_id?: number
          delivery_date?: string | null
          gst_amount?: number
          id?: number
          notes?: string | null
          order_date?: string
          payment_date?: string | null
          so_number?: string
          status?: Database["public"]["Enums"]["so_status"]
          subtotal?: number
          total?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_order_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_ageing"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "sales_order_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_outstanding"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "sales_order_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_order_line: {
        Row: {
          amount: number | null
          costing_id: number | null
          delivered_m: number
          fabric_quality_id: number | null
          id: number
          notes: string | null
          pieces: number | null
          quantity_m: number
          rate_per_m: number
          so_id: number
          uom: string
        }
        Insert: {
          amount?: number | null
          costing_id?: number | null
          delivered_m?: number
          fabric_quality_id?: number | null
          id?: number
          notes?: string | null
          pieces?: number | null
          quantity_m: number
          rate_per_m: number
          so_id: number
          uom?: string
        }
        Update: {
          amount?: number | null
          costing_id?: number | null
          delivered_m?: number
          fabric_quality_id?: number | null
          id?: number
          notes?: string | null
          pieces?: number | null
          quantity_m?: number
          rate_per_m?: number
          so_id?: number
          uom?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_order_line_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "costing_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_line_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "v_costing_two_cost"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_line_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "v_quality_margin"
            referencedColumns: ["costing_id"]
          },
          {
            foreignKeyName: "sales_order_line_fabric_quality_id_fkey"
            columns: ["fabric_quality_id"]
            isOneToOne: false
            referencedRelation: "fabric_quality"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_line_so_id_fkey"
            columns: ["so_id"]
            isOneToOne: false
            referencedRelation: "sales_order"
            referencedColumns: ["id"]
          },
        ]
      }
      sizing_job: {
        Row: {
          amount_paid: number
          avg_count: number | null
          bill_date: string
          bill_no: string | null
          charges_amount: number
          created_at: string
          created_by: string | null
          date_received: string | null
          date_sent: string | null
          default_outsource_ledger_id: number | null
          default_production_mode:
            | Database["public"]["Enums"]["pavu_production_mode"]
            | null
          gst_pct: number
          id: number
          job_code: string
          no_of_paavu: number
          notes: string | null
          party_id: number | null
          round_off: number
          set_no: string | null
          sizing_ledger_id: number | null
          sizing_rate_per_kg: number
          status: Database["public"]["Enums"]["sizing_job_status"]
          total_amount: number
          updated_at: string
          updated_by: string | null
          warp_count_id: number
          yarn_lot_id: number | null
          yarn_sent_kg: number
          yarn_source: Database["public"]["Enums"]["yarn_source"]
          yarn_supplier_party_id: number | null
          yarn_used_kg: number
        }
        Insert: {
          amount_paid?: number
          avg_count?: number | null
          bill_date: string
          bill_no?: string | null
          charges_amount?: number
          created_at?: string
          created_by?: string | null
          date_received?: string | null
          date_sent?: string | null
          default_outsource_ledger_id?: number | null
          default_production_mode?:
            | Database["public"]["Enums"]["pavu_production_mode"]
            | null
          gst_pct?: number
          id?: number
          job_code: string
          no_of_paavu?: number
          notes?: string | null
          party_id?: number | null
          round_off?: number
          set_no?: string | null
          sizing_ledger_id?: number | null
          sizing_rate_per_kg?: number
          status?: Database["public"]["Enums"]["sizing_job_status"]
          total_amount?: number
          updated_at?: string
          updated_by?: string | null
          warp_count_id: number
          yarn_lot_id?: number | null
          yarn_sent_kg?: number
          yarn_source?: Database["public"]["Enums"]["yarn_source"]
          yarn_supplier_party_id?: number | null
          yarn_used_kg?: number
        }
        Update: {
          amount_paid?: number
          avg_count?: number | null
          bill_date?: string
          bill_no?: string | null
          charges_amount?: number
          created_at?: string
          created_by?: string | null
          date_received?: string | null
          date_sent?: string | null
          default_outsource_ledger_id?: number | null
          default_production_mode?:
            | Database["public"]["Enums"]["pavu_production_mode"]
            | null
          gst_pct?: number
          id?: number
          job_code?: string
          no_of_paavu?: number
          notes?: string | null
          party_id?: number | null
          round_off?: number
          set_no?: string | null
          sizing_ledger_id?: number | null
          sizing_rate_per_kg?: number
          status?: Database["public"]["Enums"]["sizing_job_status"]
          total_amount?: number
          updated_at?: string
          updated_by?: string | null
          warp_count_id?: number
          yarn_lot_id?: number | null
          yarn_sent_kg?: number
          yarn_source?: Database["public"]["Enums"]["yarn_source"]
          yarn_supplier_party_id?: number | null
          yarn_used_kg?: number
        }
        Relationships: [
          {
            foreignKeyName: "sizing_job_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sizing_job_default_outsource_ledger_id_fkey"
            columns: ["default_outsource_ledger_id"]
            isOneToOne: false
            referencedRelation: "ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sizing_job_default_outsource_ledger_id_fkey"
            columns: ["default_outsource_ledger_id"]
            isOneToOne: false
            referencedRelation: "v_sizing_spend_by_vendor"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "sizing_job_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "party"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sizing_job_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "v_jobwork_payment_status"
            referencedColumns: ["party_id"]
          },
          {
            foreignKeyName: "sizing_job_sizing_ledger_id_fkey"
            columns: ["sizing_ledger_id"]
            isOneToOne: false
            referencedRelation: "ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sizing_job_sizing_ledger_id_fkey"
            columns: ["sizing_ledger_id"]
            isOneToOne: false
            referencedRelation: "v_sizing_spend_by_vendor"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "sizing_job_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sizing_job_warp_count_id_fkey"
            columns: ["warp_count_id"]
            isOneToOne: false
            referencedRelation: "v_stock_on_hand"
            referencedColumns: ["yarn_count_id"]
          },
          {
            foreignKeyName: "sizing_job_warp_count_id_fkey"
            columns: ["warp_count_id"]
            isOneToOne: false
            referencedRelation: "v_yarn_cover_dashboard"
            referencedColumns: ["yarn_count_id"]
          },
          {
            foreignKeyName: "sizing_job_warp_count_id_fkey"
            columns: ["warp_count_id"]
            isOneToOne: false
            referencedRelation: "yarn_count"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sizing_job_yarn_lot_id_fkey"
            columns: ["yarn_lot_id"]
            isOneToOne: false
            referencedRelation: "yarn_lot"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sizing_job_yarn_supplier_party_id_fkey"
            columns: ["yarn_supplier_party_id"]
            isOneToOne: false
            referencedRelation: "party"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sizing_job_yarn_supplier_party_id_fkey"
            columns: ["yarn_supplier_party_id"]
            isOneToOne: false
            referencedRelation: "v_jobwork_payment_status"
            referencedColumns: ["party_id"]
          },
        ]
      }
      stock_ledger: {
        Row: {
          bobbin_id: number | null
          bucket: string
          created_at: string
          created_by: string | null
          direction: string
          event_date: string
          fabric_quality_id: number | null
          id: number
          jobwork_party_id: number | null
          notes: string | null
          quantity: number
          reference_no: string | null
          source_id: number | null
          source_kind: string
          unit: string
          yarn_count_id: number | null
        }
        Insert: {
          bobbin_id?: number | null
          bucket: string
          created_at?: string
          created_by?: string | null
          direction?: string
          event_date?: string
          fabric_quality_id?: number | null
          id?: number
          jobwork_party_id?: number | null
          notes?: string | null
          quantity?: number
          reference_no?: string | null
          source_id?: number | null
          source_kind: string
          unit: string
          yarn_count_id?: number | null
        }
        Update: {
          bobbin_id?: number | null
          bucket?: string
          created_at?: string
          created_by?: string | null
          direction?: string
          event_date?: string
          fabric_quality_id?: number | null
          id?: number
          jobwork_party_id?: number | null
          notes?: string | null
          quantity?: number
          reference_no?: string | null
          source_id?: number | null
          source_kind?: string
          unit?: string
          yarn_count_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_ledger_bobbin_id_fkey"
            columns: ["bobbin_id"]
            isOneToOne: false
            referencedRelation: "bobbin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_ledger_bobbin_id_fkey"
            columns: ["bobbin_id"]
            isOneToOne: false
            referencedRelation: "v_bobbin_consumption"
            referencedColumns: ["bobbin_id"]
          },
          {
            foreignKeyName: "stock_ledger_fabric_quality_id_fkey"
            columns: ["fabric_quality_id"]
            isOneToOne: false
            referencedRelation: "fabric_quality"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_ledger_jobwork_party_id_fkey"
            columns: ["jobwork_party_id"]
            isOneToOne: false
            referencedRelation: "jobwork_party"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_ledger_yarn_count_id_fkey"
            columns: ["yarn_count_id"]
            isOneToOne: false
            referencedRelation: "v_stock_on_hand"
            referencedColumns: ["yarn_count_id"]
          },
          {
            foreignKeyName: "stock_ledger_yarn_count_id_fkey"
            columns: ["yarn_count_id"]
            isOneToOne: false
            referencedRelation: "v_yarn_cover_dashboard"
            referencedColumns: ["yarn_count_id"]
          },
          {
            foreignKeyName: "stock_ledger_yarn_count_id_fkey"
            columns: ["yarn_count_id"]
            isOneToOne: false
            referencedRelation: "yarn_count"
            referencedColumns: ["id"]
          },
        ]
      }
      system_config: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      wage_entry: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          employee_id: number
          id: number
          kind: string
          loan_deduction: number
          notes: string | null
          pay_date: string
          period_end: string
          period_start: string
          source_ledger_id: number | null
          target_ledger_id: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          employee_id: number
          id?: number
          kind: string
          loan_deduction?: number
          notes?: string | null
          pay_date: string
          period_end: string
          period_start: string
          source_ledger_id?: number | null
          target_ledger_id?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          employee_id?: number
          id?: number
          kind?: string
          loan_deduction?: number
          notes?: string | null
          pay_date?: string
          period_end?: string
          period_start?: string
          source_ledger_id?: number | null
          target_ledger_id?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wage_entry_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wage_entry_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employee"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wage_entry_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_attendance_detail"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "wage_entry_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_attendance_monthly"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "wage_entry_source_ledger_id_fkey"
            columns: ["source_ledger_id"]
            isOneToOne: false
            referencedRelation: "ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wage_entry_source_ledger_id_fkey"
            columns: ["source_ledger_id"]
            isOneToOne: false
            referencedRelation: "v_sizing_spend_by_vendor"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "wage_entry_target_ledger_id_fkey"
            columns: ["target_ledger_id"]
            isOneToOne: false
            referencedRelation: "ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wage_entry_target_ledger_id_fkey"
            columns: ["target_ledger_id"]
            isOneToOne: false
            referencedRelation: "v_sizing_spend_by_vendor"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "wage_entry_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_wage_summary: {
        Row: {
          created_at: string
          created_by: string | null
          expenses: Json
          fy_label: string
          id: number
          per_employee: Json
          totals: Json
          wage_entries: Json
          week_end: string
          week_no: number
          week_start: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expenses: Json
          fy_label: string
          id?: number
          per_employee: Json
          totals: Json
          wage_entries: Json
          week_end: string
          week_no: number
          week_start: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expenses?: Json
          fy_label?: string
          id?: number
          per_employee?: Json
          totals?: Json
          wage_entries?: Json
          week_end?: string
          week_no?: number
          week_start?: string
        }
        Relationships: []
      }
      yarn_count: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          default_yarn_kind: string
          denier: number | null
          display_name: string
          id: number
          is_doubled: boolean
          is_slub: boolean
          ne: number | null
          nec_computed: number | null
          notes: string | null
          reorder_kg: number
          status: Database["public"]["Enums"]["record_status"]
          tex: number | null
          updated_at: string
          updated_by: string | null
          yarn_type: Database["public"]["Enums"]["yarn_type"]
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          default_yarn_kind?: string
          denier?: number | null
          display_name: string
          id?: number
          is_doubled?: boolean
          is_slub?: boolean
          ne?: number | null
          nec_computed?: number | null
          notes?: string | null
          reorder_kg?: number
          status?: Database["public"]["Enums"]["record_status"]
          tex?: number | null
          updated_at?: string
          updated_by?: string | null
          yarn_type?: Database["public"]["Enums"]["yarn_type"]
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          default_yarn_kind?: string
          denier?: number | null
          display_name?: string
          id?: number
          is_doubled?: boolean
          is_slub?: boolean
          ne?: number | null
          nec_computed?: number | null
          notes?: string | null
          reorder_kg?: number
          status?: Database["public"]["Enums"]["record_status"]
          tex?: number | null
          updated_at?: string
          updated_by?: string | null
          yarn_type?: Database["public"]["Enums"]["yarn_type"]
        }
        Relationships: [
          {
            foreignKeyName: "yarn_count_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yarn_count_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
        ]
      }
      yarn_lot: {
        Row: {
          amount_paid: number
          bag_count: number
          broker_ledger_id: number | null
          brokerage_amount: number | null
          brokerage_per_bag: number
          cost_per_kg: number
          created_at: string
          created_by: string | null
          current_kg: number
          delivery_destination: string
          due_date: string | null
          gst_pct: number
          id: number
          invoice_no: string | null
          lot_code: string
          notes: string | null
          purchase_invoice_id: number | null
          received_date: string
          received_kg: number
          round_off: number
          sizing_ledger_id: number | null
          supplier_party_id: number | null
          total_amount: number | null
          yarn_count_id: number
          yarn_kind: string
        }
        Insert: {
          amount_paid?: number
          bag_count?: number
          broker_ledger_id?: number | null
          brokerage_amount?: number | null
          brokerage_per_bag?: number
          cost_per_kg: number
          created_at?: string
          created_by?: string | null
          current_kg: number
          delivery_destination?: string
          due_date?: string | null
          gst_pct?: number
          id?: number
          invoice_no?: string | null
          lot_code: string
          notes?: string | null
          purchase_invoice_id?: number | null
          received_date: string
          received_kg: number
          round_off?: number
          sizing_ledger_id?: number | null
          supplier_party_id?: number | null
          total_amount?: number | null
          yarn_count_id: number
          yarn_kind?: string
        }
        Update: {
          amount_paid?: number
          bag_count?: number
          broker_ledger_id?: number | null
          brokerage_amount?: number | null
          brokerage_per_bag?: number
          cost_per_kg?: number
          created_at?: string
          created_by?: string | null
          current_kg?: number
          delivery_destination?: string
          due_date?: string | null
          gst_pct?: number
          id?: number
          invoice_no?: string | null
          lot_code?: string
          notes?: string | null
          purchase_invoice_id?: number | null
          received_date?: string
          received_kg?: number
          round_off?: number
          sizing_ledger_id?: number | null
          supplier_party_id?: number | null
          total_amount?: number | null
          yarn_count_id?: number
          yarn_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_yarn_lot_purchase"
            columns: ["purchase_invoice_id"]
            isOneToOne: false
            referencedRelation: "yarn_purchase"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yarn_lot_broker_ledger_id_fkey"
            columns: ["broker_ledger_id"]
            isOneToOne: false
            referencedRelation: "ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yarn_lot_broker_ledger_id_fkey"
            columns: ["broker_ledger_id"]
            isOneToOne: false
            referencedRelation: "v_sizing_spend_by_vendor"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "yarn_lot_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yarn_lot_sizing_ledger_id_fkey"
            columns: ["sizing_ledger_id"]
            isOneToOne: false
            referencedRelation: "ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yarn_lot_sizing_ledger_id_fkey"
            columns: ["sizing_ledger_id"]
            isOneToOne: false
            referencedRelation: "v_sizing_spend_by_vendor"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "yarn_lot_supplier_party_id_fkey"
            columns: ["supplier_party_id"]
            isOneToOne: false
            referencedRelation: "party"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yarn_lot_supplier_party_id_fkey"
            columns: ["supplier_party_id"]
            isOneToOne: false
            referencedRelation: "v_jobwork_payment_status"
            referencedColumns: ["party_id"]
          },
          {
            foreignKeyName: "yarn_lot_yarn_count_id_fkey"
            columns: ["yarn_count_id"]
            isOneToOne: false
            referencedRelation: "v_stock_on_hand"
            referencedColumns: ["yarn_count_id"]
          },
          {
            foreignKeyName: "yarn_lot_yarn_count_id_fkey"
            columns: ["yarn_count_id"]
            isOneToOne: false
            referencedRelation: "v_yarn_cover_dashboard"
            referencedColumns: ["yarn_count_id"]
          },
          {
            foreignKeyName: "yarn_lot_yarn_count_id_fkey"
            columns: ["yarn_count_id"]
            isOneToOne: false
            referencedRelation: "yarn_count"
            referencedColumns: ["id"]
          },
        ]
      }
      yarn_purchase: {
        Row: {
          created_at: string
          created_by: string | null
          freight: number
          gst_amount: number
          id: number
          internal_no: string
          invoice_date: string
          invoice_no: string
          mill_id: number
          notes: string | null
          payment_status: Database["public"]["Enums"]["invoice_status"]
          received_date: string | null
          subtotal: number
          total: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          freight?: number
          gst_amount?: number
          id?: number
          internal_no: string
          invoice_date: string
          invoice_no: string
          mill_id: number
          notes?: string | null
          payment_status?: Database["public"]["Enums"]["invoice_status"]
          received_date?: string | null
          subtotal?: number
          total?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          freight?: number
          gst_amount?: number
          id?: number
          internal_no?: string
          invoice_date?: string
          invoice_no?: string
          mill_id?: number
          notes?: string | null
          payment_status?: Database["public"]["Enums"]["invoice_status"]
          received_date?: string | null
          subtotal?: number
          total?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "yarn_purchase_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yarn_purchase_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
        ]
      }
      yarn_purchase_line: {
        Row: {
          amount: number | null
          id: number
          lot_id: number | null
          purchase_id: number
          quantity_kg: number
          rate_per_kg: number
          yarn_count_id: number
        }
        Insert: {
          amount?: number | null
          id?: number
          lot_id?: number | null
          purchase_id: number
          quantity_kg: number
          rate_per_kg: number
          yarn_count_id: number
        }
        Update: {
          amount?: number | null
          id?: number
          lot_id?: number | null
          purchase_id?: number
          quantity_kg?: number
          rate_per_kg?: number
          yarn_count_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "yarn_purchase_line_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "yarn_lot"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yarn_purchase_line_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "yarn_purchase"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yarn_purchase_line_yarn_count_id_fkey"
            columns: ["yarn_count_id"]
            isOneToOne: false
            referencedRelation: "v_stock_on_hand"
            referencedColumns: ["yarn_count_id"]
          },
          {
            foreignKeyName: "yarn_purchase_line_yarn_count_id_fkey"
            columns: ["yarn_count_id"]
            isOneToOne: false
            referencedRelation: "v_yarn_cover_dashboard"
            referencedColumns: ["yarn_count_id"]
          },
          {
            foreignKeyName: "yarn_purchase_line_yarn_count_id_fkey"
            columns: ["yarn_count_id"]
            isOneToOne: false
            referencedRelation: "yarn_count"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_agent_commission_report: {
        Row: {
          agent_code: string | null
          agent_name: string | null
          agent_party_id: number | null
          business_value: number | null
          commission_amount: number | null
          commission_balance: number | null
          commission_id: number | null
          commission_paid: number | null
          commission_rate: number | null
          commission_type: string | null
          counterparty_name: string | null
          doc_date: string | null
          doc_no: string | null
          side: string | null
          source: string | null
          source_id: number | null
          status: string | null
        }
        Relationships: []
      }
      v_attendance_by_role: {
        Row: {
          absent_count: number | null
          early_leave_count: number | null
          employee_count: number | null
          employee_role: Database["public"]["Enums"]["employee_role"] | null
          half_day_count: number | null
          late_count: number | null
          month: string | null
          present_count: number | null
          present_pct: number | null
          shifts_marked: number | null
        }
        Relationships: []
      }
      v_attendance_detail: {
        Row: {
          attendance_date: string | null
          day_weight: number | null
          employee_code: string | null
          employee_id: number | null
          employee_name: string | null
          employee_role: Database["public"]["Enums"]["employee_role"] | null
          entry_remark: string | null
          shift: Database["public"]["Enums"]["shift_code"] | null
          status: Database["public"]["Enums"]["attendance_status"] | null
        }
        Relationships: []
      }
      v_attendance_monthly: {
        Row: {
          absent_count: number | null
          attendance_days: number | null
          early_leave_count: number | null
          employee_code: string | null
          employee_id: number | null
          employee_name: string | null
          employee_role: Database["public"]["Enums"]["employee_role"] | null
          half_day_count: number | null
          late_count: number | null
          month: string | null
          present_count: number | null
          shifts_marked: number | null
        }
        Relationships: []
      }
      v_bank_entry: {
        Row: {
          amount: number | null
          bank_ledger_id: number | null
          bank_name: string | null
          category_code: string | null
          category_id: number | null
          category_name: string | null
          created_at: string | null
          direction: string | null
          entry_date: string | null
          entry_no: string | null
          id: number | null
          mode: string | null
          notes: string | null
          other_ledger_id: number | null
          other_name: string | null
          pl_treatment: string | null
          reference: string | null
          status: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_entry_bank_ledger_id_fkey"
            columns: ["bank_ledger_id"]
            isOneToOne: false
            referencedRelation: "ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_entry_bank_ledger_id_fkey"
            columns: ["bank_ledger_id"]
            isOneToOne: false
            referencedRelation: "v_sizing_spend_by_vendor"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "bank_entry_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "bank_category"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_entry_other_ledger_id_fkey"
            columns: ["other_ledger_id"]
            isOneToOne: false
            referencedRelation: "ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_entry_other_ledger_id_fkey"
            columns: ["other_ledger_id"]
            isOneToOne: false
            referencedRelation: "v_sizing_spend_by_vendor"
            referencedColumns: ["vendor_id"]
          },
        ]
      }
      v_batch_expense_allocation: {
        Row: {
          allocated_expense_inr: number | null
          batch_id: number | null
          category: string | null
          expense_amount_inr: number | null
          expense_entry_id: number | null
        }
        Relationships: []
      }
      v_batch_expense_total: {
        Row: {
          batch_code: string | null
          batch_id: number | null
          expense_per_m: number | null
          produced_m: number | null
          total_expense_inr: number | null
        }
        Relationships: []
      }
      v_batch_sizing_variance: {
        Row: {
          actual_sizing_cost_per_m: number | null
          batch_code: string | null
          batch_id: number | null
          costing_id: number | null
          live_sizing_rate_per_kg: number | null
          pavu_assign_id: number | null
          pavu_id: number | null
          planned_sizing_cost_per_m: number | null
          produced_m: number | null
          sizing_job_code: string | null
          sizing_job_id: number | null
          sizing_job_total_meters: number | null
          sizing_job_yarn_used_kg: number | null
          snapshot_sizing_rate_per_kg: number | null
          variance_per_m: number | null
          variance_total: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pavu_assign_pavu_id_fkey"
            columns: ["pavu_id"]
            isOneToOne: false
            referencedRelation: "pavu"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pavu_sizing_job_id_fkey"
            columns: ["sizing_job_id"]
            isOneToOne: false
            referencedRelation: "sizing_job"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pavu_sizing_job_id_fkey"
            columns: ["sizing_job_id"]
            isOneToOne: false
            referencedRelation: "v_sizing_job_balance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_batch_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "costing_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_batch_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "v_costing_two_cost"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_batch_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "v_quality_margin"
            referencedColumns: ["costing_id"]
          },
          {
            foreignKeyName: "production_batch_pavu_assign_id_fkey"
            columns: ["pavu_assign_id"]
            isOneToOne: false
            referencedRelation: "pavu_assign"
            referencedColumns: ["id"]
          },
        ]
      }
      v_batch_wage_allocation: {
        Row: {
          allocated_wage_inr: number | null
          basis: string | null
          batch_id: number | null
          employee_id: number | null
          wage_amount_inr: number | null
          wage_entry_id: number | null
        }
        Relationships: [
          {
            foreignKeyName: "wage_entry_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employee"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wage_entry_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_attendance_detail"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "wage_entry_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_attendance_monthly"
            referencedColumns: ["employee_id"]
          },
        ]
      }
      v_batch_wage_total: {
        Row: {
          batch_code: string | null
          batch_id: number | null
          produced_m: number | null
          total_wage_inr: number | null
          wage_per_m: number | null
        }
        Relationships: []
      }
      v_bobbin_consumption: {
        Row: {
          batches_used: number | null
          below_reorder: boolean | null
          bobbin_id: number | null
          bobbin_metre: number | null
          bobbin_price: number | null
          bobbin_spend: number | null
          code: string | null
          description: string | null
          ends_per_bobbin: number | null
          is_lurex: boolean | null
          loading_per_metre: number | null
          partial_piece_fraction: number | null
          pieces_consumed_equiv: number | null
          produced_m_total: number | null
          reorder_pieces: number | null
          rupee_per_m: number | null
          stock_pcs: number | null
          vendor_id: number | null
          vendor_name: string | null
          whole_pieces_consumed: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bobbin_supplier_party_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "party"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bobbin_supplier_party_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "v_jobwork_payment_status"
            referencedColumns: ["party_id"]
          },
        ]
      }
      v_cashflow_recent: {
        Row: {
          amount: number | null
          category_code: string | null
          category_name: string | null
          days_ago: number | null
          direction: string | null
          doc_no: string | null
          event_date: string | null
          invoice_no: string | null
          mode: string | null
          party_code: string | null
          party_kind: string | null
          party_name: string | null
          reference: string | null
          source_id: number | null
          source_kind: string | null
        }
        Relationships: []
      }
      v_cashflow_snapshot: {
        Row: {
          in_30d: number | null
          in_7d: number | null
          in_90d: number | null
          in_count_30d: number | null
          in_due_30d: number | null
          in_due_7d: number | null
          in_overdue: number | null
          last_payment_date: string | null
          net_30d: number | null
          net_7d: number | null
          net_90d: number | null
          net_due_30d: number | null
          net_due_7d: number | null
          out_30d: number | null
          out_7d: number | null
          out_90d: number | null
          out_count_30d: number | null
          out_due_30d: number | null
          out_due_7d: number | null
          out_overdue: number | null
        }
        Relationships: []
      }
      v_costing_two_cost: {
        Row: {
          delta_porvai_per_m: number | null
          delta_warp_per_m: number | null
          delta_weft_per_m: number | null
          grams_per_m: number | null
          gsm: number | null
          id: number | null
          live_porvai_cost_per_kg: number | null
          live_warp_cost_per_kg: number | null
          live_weft_cost_per_kg: number | null
          quality_code: string | null
          quality_name: string | null
          quoted_cost_per_m: number | null
          sizing_cost_per_m: number | null
          true_cost_per_m: number | null
          warp_m_per_kg: number | null
          weft_m_per_kg: number | null
        }
        Relationships: []
      }
      v_customer_ageing: {
        Row: {
          bucket_0_30: number | null
          bucket_31_60: number | null
          bucket_61_90: number | null
          bucket_90_plus: number | null
          city: string | null
          code: string | null
          credit_limit: number | null
          customer_id: number | null
          customer_status: Database["public"]["Enums"]["record_status"] | null
          is_vip: boolean | null
          last_invoice_date: string | null
          last_payment_date: string | null
          name: string | null
          oldest_age_days: number | null
          open_invoice_count: number | null
          over_credit_limit: boolean | null
          overdue_amount: number | null
          payment_terms_days: number | null
          state: string | null
          total_outstanding: number | null
        }
        Relationships: []
      }
      v_customer_outstanding: {
        Row: {
          code: string | null
          customer_id: number | null
          last_invoice_date: string | null
          name: string | null
          outstanding: number | null
          overdue: number | null
        }
        Relationships: []
      }
      v_invoice_delivery_status: {
        Row: {
          customer_code: string | null
          customer_id: number | null
          customer_name: string | null
          dc_count: number | null
          delivered_m: number | null
          delivery_status: string | null
          doc_type: Database["public"]["Enums"]["invoice_doc_type"] | null
          invoice_date: string | null
          invoice_id: number | null
          invoice_no: string | null
          invoice_status: Database["public"]["Enums"]["invoice_status"] | null
          invoice_total: number | null
          invoiced_m: number | null
          last_dc_date: string | null
          undelivered_m: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_ageing"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "invoice_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_outstanding"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      v_jobwork_payment_status: {
        Row: {
          days_since_last_payment: number | null
          days_since_last_receipt: number | null
          last_payment_date: string | null
          last_receipt_date: string | null
          metres_received_ytd: number | null
          party_code: string | null
          party_id: number | null
          party_name: string | null
          payments_out_ytd: number | null
        }
        Relationships: []
      }
      v_loom_shift_utilisation: {
        Row: {
          avg_metres_per_shift: number | null
          last_log_date: string | null
          loom_code: string | null
          loom_id: number | null
          loom_type: string | null
          shift_count: number | null
          status: string | null
          total_metres: number | null
        }
        Relationships: []
      }
      v_loom_utilisation: {
        Row: {
          active_days: number | null
          avg_m_per_batch: number | null
          batch_count: number | null
          finished_batches: number | null
          first_batch_start: string | null
          last_batch_end: string | null
          loom_code: string | null
          loom_id: number | null
          loom_type: string | null
          m_per_active_day: number | null
          rejection_pct: number | null
          running_batches: number | null
          status: string | null
          total_produced_m: number | null
          total_rejected_m: number | null
          width_in: number | null
        }
        Relationships: []
      }
      v_looms_overhead: {
        Row: {
          depreciation_per_m: number | null
          insurance_per_m: number | null
          labour_per_m: number | null
          maintenance_per_m: number | null
          power_per_m: number | null
          total_per_m: number | null
        }
        Relationships: []
      }
      v_non_working_days: {
        Row: {
          attendance_date: string | null
          marked_at: string | null
          marked_by_name: string | null
          reason: Database["public"]["Enums"]["non_working_reason"] | null
          remark: string | null
          shift: Database["public"]["Enums"]["shift_code"] | null
        }
        Relationships: []
      }
      v_production_batch_with_source: {
        Row: {
          actual_bobbin_cost_per_m: number | null
          actual_overhead_per_m: number | null
          actual_pick_cost_per_m: number | null
          actual_porvai_cost_per_m: number | null
          actual_sizing_cost_per_m: number | null
          actual_sizing_rate_per_kg: number | null
          actual_true_cost_per_m: number | null
          actual_warp_cost_per_m: number | null
          actual_weft_cost_per_m: number | null
          batch_code: string | null
          bobbin_1_id: number | null
          bobbin_2_id: number | null
          costing_id: number | null
          created_at: string | null
          created_by: string | null
          end_date: string | null
          id: number | null
          loom_id: number | null
          notes: string | null
          outsource_order_id: number | null
          outsource_vendor_id: number | null
          outsource_vendor_name: string | null
          ow_number: string | null
          pavu_assign_id: number | null
          porvai_lot_id: number | null
          produced_m: number | null
          rejected_m: number | null
          so_line_id: number | null
          source_kind: string | null
          start_date: string | null
          updated_at: string | null
          updated_by: string | null
          warp_lot_id: number | null
          weft_lot_id: number | null
        }
        Relationships: [
          {
            foreignKeyName: "outsource_order_ledger_id_fkey"
            columns: ["outsource_vendor_id"]
            isOneToOne: false
            referencedRelation: "ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outsource_order_ledger_id_fkey"
            columns: ["outsource_vendor_id"]
            isOneToOne: false
            referencedRelation: "v_sizing_spend_by_vendor"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "production_batch_bobbin_1_id_fkey"
            columns: ["bobbin_1_id"]
            isOneToOne: false
            referencedRelation: "bobbin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_batch_bobbin_1_id_fkey"
            columns: ["bobbin_1_id"]
            isOneToOne: false
            referencedRelation: "v_bobbin_consumption"
            referencedColumns: ["bobbin_id"]
          },
          {
            foreignKeyName: "production_batch_bobbin_2_id_fkey"
            columns: ["bobbin_2_id"]
            isOneToOne: false
            referencedRelation: "bobbin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_batch_bobbin_2_id_fkey"
            columns: ["bobbin_2_id"]
            isOneToOne: false
            referencedRelation: "v_bobbin_consumption"
            referencedColumns: ["bobbin_id"]
          },
          {
            foreignKeyName: "production_batch_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "costing_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_batch_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "v_costing_two_cost"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_batch_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "v_quality_margin"
            referencedColumns: ["costing_id"]
          },
          {
            foreignKeyName: "production_batch_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_batch_loom_id_fkey"
            columns: ["loom_id"]
            isOneToOne: false
            referencedRelation: "loom"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_batch_loom_id_fkey"
            columns: ["loom_id"]
            isOneToOne: false
            referencedRelation: "v_loom_shift_utilisation"
            referencedColumns: ["loom_id"]
          },
          {
            foreignKeyName: "production_batch_loom_id_fkey"
            columns: ["loom_id"]
            isOneToOne: false
            referencedRelation: "v_loom_utilisation"
            referencedColumns: ["loom_id"]
          },
          {
            foreignKeyName: "production_batch_outsource_order_id_fkey"
            columns: ["outsource_order_id"]
            isOneToOne: false
            referencedRelation: "outsource_order"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_batch_pavu_assign_id_fkey"
            columns: ["pavu_assign_id"]
            isOneToOne: false
            referencedRelation: "pavu_assign"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_batch_porvai_lot_id_fkey"
            columns: ["porvai_lot_id"]
            isOneToOne: false
            referencedRelation: "yarn_lot"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_batch_so_line_id_fkey"
            columns: ["so_line_id"]
            isOneToOne: false
            referencedRelation: "sales_order_line"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_batch_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_batch_warp_lot_id_fkey"
            columns: ["warp_lot_id"]
            isOneToOne: false
            referencedRelation: "yarn_lot"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_batch_weft_lot_id_fkey"
            columns: ["weft_lot_id"]
            isOneToOne: false
            referencedRelation: "yarn_lot"
            referencedColumns: ["id"]
          },
        ]
      }
      v_purchase_register: {
        Row: {
          amount_paid: number | null
          balance: number | null
          bill_date: string | null
          bill_no: string | null
          cgst_amount: number | null
          gst_amount: number | null
          gst_flag: string | null
          gst_pct: number | null
          igst_amount: number | null
          is_interstate: boolean | null
          party_code: string | null
          party_gstin: string | null
          party_id: number | null
          party_name: string | null
          party_state: string | null
          qty_uom: string | null
          quantity: number | null
          round_off: number | null
          sgst_amount: number | null
          source: string | null
          source_id: number | null
          status: string | null
          taxable: number | null
          total: number | null
        }
        Relationships: []
      }
      v_quality_margin: {
        Row: {
          avg_cost_per_m: number | null
          avg_sell_per_m: number | null
          costing_id: number | null
          invoiced_m: number | null
          last_batch_date: string | null
          last_invoice_date: string | null
          margin: number | null
          margin_pct: number | null
          produced_m: number | null
          quality_code: string | null
          quality_name: string | null
          total_cost: number | null
          total_revenue: number | null
        }
        Relationships: []
      }
      v_sales_register: {
        Row: {
          amount_paid: number | null
          balance: number | null
          cgst_amount: number | null
          customer_code: string | null
          customer_id: number | null
          customer_name: string | null
          doc_type: Database["public"]["Enums"]["invoice_doc_type"] | null
          gst_amount: number | null
          igst_amount: number | null
          invoice_date: string | null
          invoice_id: number | null
          invoice_no: string | null
          is_interstate: boolean | null
          party_gstin: string | null
          party_state: string | null
          sgst_amount: number | null
          sign: number | null
          signed_cgst: number | null
          signed_gst: number | null
          signed_igst: number | null
          signed_sgst: number | null
          signed_taxable: number | null
          signed_total: number | null
          status: Database["public"]["Enums"]["invoice_status"] | null
          taxable_value: number | null
          total: number | null
          total_quantity: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_ageing"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "invoice_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_outstanding"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      v_sizing_job_balance: {
        Row: {
          id: number | null
          job_code: string | null
          set_no: string | null
          yarn_balance_kg: number | null
          yarn_sent_kg: number | null
          yarn_used_kg: number | null
        }
        Insert: {
          id?: number | null
          job_code?: string | null
          set_no?: string | null
          yarn_balance_kg?: never
          yarn_sent_kg?: number | null
          yarn_used_kg?: number | null
        }
        Update: {
          id?: number | null
          job_code?: string | null
          set_no?: string | null
          yarn_balance_kg?: never
          yarn_sent_kg?: number | null
          yarn_used_kg?: number | null
        }
        Relationships: []
      }
      v_sizing_spend_by_month: {
        Row: {
          effective_rate_per_kg: number | null
          jobs_count: number | null
          period_start: string | null
          total_spend: number | null
          total_yarn_kg: number | null
        }
        Relationships: []
      }
      v_sizing_spend_by_vendor: {
        Row: {
          effective_rate_per_kg: number | null
          first_job_date: string | null
          jobs_count: number | null
          last_job_date: string | null
          total_spend: number | null
          total_yarn_kg: number | null
          vendor_code: string | null
          vendor_id: number | null
          vendor_name: string | null
        }
        Relationships: []
      }
      v_stock_on_hand: {
        Row: {
          available_kg: number | null
          below_reorder: boolean | null
          code: string | null
          days_of_cover: number | null
          denier: number | null
          display_name: string | null
          is_doubled: boolean | null
          is_slub: boolean | null
          kg_30d: number | null
          lots_count: number | null
          ne: number | null
          newest_lot_date: string | null
          oldest_lot_date: string | null
          reorder_kg: number | null
          status: Database["public"]["Enums"]["record_status"] | null
          stock_value: number | null
          weighted_avg_cost: number | null
          yarn_count_id: number | null
          yarn_type: Database["public"]["Enums"]["yarn_type"] | null
        }
        Relationships: []
      }
      v_stock_on_hand_summary: {
        Row: {
          category: string | null
          mode: string | null
          qty: number | null
          unit: string | null
        }
        Relationships: []
      }
      v_today_attendance_widget: {
        Row: {
          attendance_date: string | null
          employee_role: Database["public"]["Enums"]["employee_role"] | null
          headcount: number | null
          is_working: boolean | null
          present_count: number | null
          reason: string | null
          remark: string | null
          shift: Database["public"]["Enums"]["shift_code"] | null
        }
        Relationships: []
      }
      v_variance_by_batch: {
        Row: {
          actual_pick_per_m: number | null
          actual_sizing_per_m: number | null
          actual_true_per_m: number | null
          actual_warp_per_m: number | null
          actual_weft_per_m: number | null
          batch_code: string | null
          batch_id: number | null
          costing_id: number | null
          end_date: string | null
          planned_pick_per_m: number | null
          planned_sizing_per_m: number | null
          planned_true_per_m: number | null
          planned_warp_per_m: number | null
          planned_weft_per_m: number | null
          produced_m: number | null
          quality_code: string | null
          quality_name: string | null
          rejected_m: number | null
          start_date: string | null
          total_variance_inr: number | null
          variance_pct: number | null
          variance_per_m: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fabric_quality_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "costing_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fabric_quality_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "v_costing_two_cost"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fabric_quality_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "v_quality_margin"
            referencedColumns: ["costing_id"]
          },
        ]
      }
      v_variance_by_quality: {
        Row: {
          actual_pick_per_m: number | null
          actual_sizing_per_m: number | null
          actual_true_per_m: number | null
          actual_warp_per_m: number | null
          actual_weft_per_m: number | null
          batch_count: number | null
          planned_pick_per_m: number | null
          planned_sizing_per_m: number | null
          planned_true_per_m: number | null
          planned_warp_per_m: number | null
          planned_weft_per_m: number | null
          produced_m: number | null
          quality_code: string | null
          quality_name: string | null
          total_variance_inr: number | null
          variance_pct: number | null
          variance_per_m: number | null
        }
        Relationships: []
      }
      v_yarn_cover_dashboard: {
        Row: {
          available_kg: number | null
          below_reorder: boolean | null
          code: string | null
          cover_status: string | null
          days_of_cover: number | null
          display_name: string | null
          kg_30d: number | null
          reorder_kg: number | null
          status: Database["public"]["Enums"]["record_status"] | null
          yarn_count_id: number | null
          yarn_type: Database["public"]["Enums"]["yarn_type"] | null
        }
        Relationships: []
      }
      v_yarn_days_of_cover: {
        Row: {
          avg_cost_per_kg: number | null
          days_of_cover: number | null
          on_hand_kg: number | null
          yarn_count_code: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      can_write_master: { Args: { p_master: string }; Returns: boolean }
      current_employee_code: { Args: never; Returns: string }
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      fn_cancel_delivery_challan: {
        Args: {
          p_dc_id: number
          p_manual_costing_id?: number
          p_move_manual_to_batch?: boolean
          p_reason?: string
          p_reuse_number?: boolean
          p_target_batch_id?: number
        }
        Returns: Json
      }
      fn_dc_auto_link_so_for: { Args: { p_dc_id: number }; Returns: undefined }
      fn_fy_code: { Args: { d: string }; Returns: string }
      fn_looms_calibration_suggest: {
        Args: { p_days_back?: number; p_wage_roles?: string[] }
        Returns: {
          insurance_per_m: number
          labour_per_m: number
          maintenance_per_m: number
          metres: number
          period_from: string
          period_to: string
          power_per_m: number
        }[]
      }
      fn_next_doc_no: { Args: { p_doc_type: string }; Returns: string }
      fn_party_balances_as_of: {
        Args: { p_as_of: string }
        Returns: {
          party_code: string
          party_id: number
          party_name: string
          payable: number
          receivable: number
        }[]
      }
      fn_pavu_stock_report: {
        Args: { p_as_of: string }
        Returns: {
          beam_no: string
          ends: number
          finished_date: string
          finished_metre: number
          loaded_metre: number
          mounted_date: string
          pavu_code: string
          pavu_id: number
          set_no: string
          status_as_of: string
          yarn_count: string
        }[]
      }
      fn_period_pnl: {
        Args: { p_from: string; p_to: string }
        Returns: {
          bank_expenses: number
          bank_income: number
          cogs: number
          credit_notes: number
          factory_expenses: number
          gross_profit: number
          net_profit: number
          period_costs: number
          period_from: string
          period_to: string
          revenue: number
          wages: number
        }[]
      }
      fn_period_pnl_split: {
        Args: { p_from: string; p_to: string }
        Returns: {
          bank_expenses_combined: number
          bank_expenses_jobwork: number
          bank_expenses_own: number
          bank_income_combined: number
          bank_income_jobwork: number
          bank_income_own: number
          cogs_combined: number
          cogs_jobwork: number
          cogs_own: number
          credit_notes_combined: number
          credit_notes_jobwork: number
          credit_notes_own: number
          direct_purchases_combined: number
          direct_purchases_jobwork: number
          direct_purchases_own: number
          factory_expenses_combined: number
          factory_expenses_jobwork: number
          factory_expenses_own: number
          gross_profit_combined: number
          gross_profit_jobwork: number
          gross_profit_own: number
          jobwork_metres: number
          jw_share: number
          net_profit_combined: number
          net_profit_jobwork: number
          net_profit_own: number
          own_metres: number
          own_share: number
          period_costs_combined: number
          period_costs_jobwork: number
          period_costs_own: number
          period_from: string
          period_to: string
          revenue_combined: number
          revenue_jobwork: number
          revenue_own: number
          total_metres: number
          wages_combined: number
          wages_jobwork: number
          wages_own: number
        }[]
      }
      fn_production_vs_delivery: {
        Args: { p_from: string; p_to: string }
        Returns: {
          delivered_m: number
          delivered_pcs: number
          fabric_quality_id: number
          is_merged: boolean
          last_activity: string
          meter_per_pc: number
          produced_m: number
          produced_pcs: number
          production_mode: string
          quality_code: string
          quality_name: string
          variance_m: number
          variance_pcs: number
          variance_pct: number
        }[]
      }
      fn_recompute_pavu_assign_metres: {
        Args: { p_loom_id: number }
        Returns: undefined
      }
      fn_resettle_agent: { Args: { p_party_id: number }; Returns: undefined }
      fn_resync_doc_sequence: { Args: { p_doc_type: string }; Returns: number }
      fn_so_refresh_status: { Args: { p_so_id: number }; Returns: undefined }
      fn_stock_on_hand_summary: {
        Args: { p_quality_id?: number }
        Returns: {
          category: string
          mode: string
          qty: number
          unit: string
        }[]
      }
      fn_warehouse_stock_as_of: {
        Args: { p_as_of: string }
        Returns: {
          bucket: string
          mode: string
          quantity: number
        }[]
      }
      fy_week_number: {
        Args: { d: string }
        Returns: {
          fy_label: string
          week_end: string
          week_no: number
          week_start: string
        }[]
      }
      is_owner_or_auditor: { Args: never; Returns: boolean }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      approval_status: "pending" | "approved" | "rejected"
      attendance_status:
        | "present"
        | "absent"
        | "half_day"
        | "late"
        | "early_leave"
        | "none"
      bobbin_location: "main_godown" | "at_vendor" | "customer_owned"
      business_model: "inhouse" | "outsourced" | "jobwork" | "resale"
      costing_save_path: "quick_quote" | "formal"
      employee_role:
        | "weaver"
        | "fitter"
        | "folder"
        | "winder"
        | "knotter"
        | "auto"
        | "office"
        | "other"
      employee_status: "active" | "inactive" | "resigned"
      fabric_delivery_destination: "in_house" | "sizing"
      fabric_production_mode: "inhouse" | "job_work" | "outsourcing"
      fabric_rate_unit: "m" | "pcs"
      fabric_type: "woven" | "towel" | "dupatta"
      invoice_doc_type:
        | "tax_invoice"
        | "yarn_sale"
        | "general_sale"
        | "credit_note"
        | "debit_note"
        | "jobwork_invoice"
        | "weaving_bill"
      invoice_source_kind:
        | "sales_order"
        | "fabric_stock"
        | "yarn_lot"
        | "free"
        | "return"
        | "fabric_receipt"
      invoice_status:
        | "draft"
        | "issued"
        | "partial_paid"
        | "paid"
        | "overdue"
        | "cancelled"
      non_working_reason:
        | "power_cut"
        | "national_holiday"
        | "maintenance"
        | "other"
      pavu_assign_status:
        | "queued"
        | "mounted"
        | "running"
        | "completed"
        | "removed"
      pavu_production_mode: "in_house" | "outsource" | "jobwork"
      pavu_status:
        | "in_stock"
        | "on_loom"
        | "finished"
        | "damaged"
        | "scrapped"
        | "assigned"
      payment_direction: "in" | "out"
      payment_mode:
        | "cash"
        | "cheque"
        | "bank_transfer"
        | "upi"
        | "card"
        | "other"
      production_mode: "inhouse" | "vendor" | "both" | "outsource"
      record_status: "active" | "archived" | "discontinued"
      shift_code: "morning" | "night"
      shift_preference: "morning" | "night" | "either"
      sizing_job_status:
        | "draft"
        | "sent"
        | "in_process"
        | "received"
        | "assigned"
        | "done"
        | "cancelled"
      so_status:
        | "draft"
        | "pending_approval"
        | "approved"
        | "in_production"
        | "partial_dispatch"
        | "dispatched"
        | "invoiced"
        | "paid"
        | "cancelled"
        | "closed"
      user_role:
        | "owner"
        | "mill_manager"
        | "sales_manager"
        | "accounts"
        | "floor_operator"
        | "auditor"
      yarn_source: "purchase_direct" | "warehouse"
      yarn_type: "cotton" | "polyester" | "blend"
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
      approval_status: ["pending", "approved", "rejected"],
      attendance_status: [
        "present",
        "absent",
        "half_day",
        "late",
        "early_leave",
        "none",
      ],
      bobbin_location: ["main_godown", "at_vendor", "customer_owned"],
      business_model: ["inhouse", "outsourced", "jobwork", "resale"],
      costing_save_path: ["quick_quote", "formal"],
      employee_role: [
        "weaver",
        "fitter",
        "folder",
        "winder",
        "knotter",
        "auto",
        "office",
        "other",
      ],
      employee_status: ["active", "inactive", "resigned"],
      fabric_delivery_destination: ["in_house", "sizing"],
      fabric_production_mode: ["inhouse", "job_work", "outsourcing"],
      fabric_rate_unit: ["m", "pcs"],
      fabric_type: ["woven", "towel", "dupatta"],
      invoice_doc_type: [
        "tax_invoice",
        "yarn_sale",
        "general_sale",
        "credit_note",
        "debit_note",
        "jobwork_invoice",
        "weaving_bill",
      ],
      invoice_source_kind: [
        "sales_order",
        "fabric_stock",
        "yarn_lot",
        "free",
        "return",
        "fabric_receipt",
      ],
      invoice_status: [
        "draft",
        "issued",
        "partial_paid",
        "paid",
        "overdue",
        "cancelled",
      ],
      non_working_reason: [
        "power_cut",
        "national_holiday",
        "maintenance",
        "other",
      ],
      pavu_assign_status: [
        "queued",
        "mounted",
        "running",
        "completed",
        "removed",
      ],
      pavu_production_mode: ["in_house", "outsource", "jobwork"],
      pavu_status: [
        "in_stock",
        "on_loom",
        "finished",
        "damaged",
        "scrapped",
        "assigned",
      ],
      payment_direction: ["in", "out"],
      payment_mode: ["cash", "cheque", "bank_transfer", "upi", "card", "other"],
      production_mode: ["inhouse", "vendor", "both", "outsource"],
      record_status: ["active", "archived", "discontinued"],
      shift_code: ["morning", "night"],
      shift_preference: ["morning", "night", "either"],
      sizing_job_status: [
        "draft",
        "sent",
        "in_process",
        "received",
        "assigned",
        "done",
        "cancelled",
      ],
      so_status: [
        "draft",
        "pending_approval",
        "approved",
        "in_production",
        "partial_dispatch",
        "dispatched",
        "invoiced",
        "paid",
        "cancelled",
        "closed",
      ],
      user_role: [
        "owner",
        "mill_manager",
        "sales_manager",
        "accounts",
        "floor_operator",
        "auditor",
      ],
      yarn_source: ["purchase_direct", "warehouse"],
      yarn_type: ["cotton", "polyester", "blend"],
    },
  },
} as const
