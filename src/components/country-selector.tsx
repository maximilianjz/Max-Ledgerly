"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { COUNTRIES } from "@/lib/countries";

const countries = Object.entries(COUNTRIES).sort(([, a], [, b]) => a.localeCompare(b, "en"));

export function CountrySelector({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (country: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id="seller-country"
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-describedby="seller-country-help"
          disabled={disabled}
          className="h-12 w-full justify-between bg-card font-normal"
        >
          <span className="truncate">{COUNTRIES[value] || "Select a country"}</span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label="Choose country"
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <Command defaultValue={value} label="Search countries">
          <CommandInput placeholder="Search by country or code…" />
          <CommandList className="max-h-[min(280px,calc(var(--radix-popover-content-available-height)-48px))] p-1">
            <CommandEmpty>No countries found.</CommandEmpty>
            {countries.map(([code, name]) => (
              <CommandItem
                key={code}
                value={code}
                keywords={[name]}
                aria-label={`${name} (${code})`}
                onSelect={() => {
                  onChange(code);
                  setOpen(false);
                }}
                className="min-h-10"
              >
                <span className="flex-1">{name}</span>
                <span className="text-xs text-muted-foreground">{code}</span>
                <Check
                  aria-hidden="true"
                  className={value === code ? "opacity-100" : "opacity-0"}
                />
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
