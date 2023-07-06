/** Weekday schedule for open close hour ranges */
export interface HourDto {
  id: number;
  dayOfWeek: number; // 0-6 day of week, 0 as Sunday
  isOpen: boolean;
  startTime: string;
  endTime: string;
}

/**  Used for today's shopping or delivery hours if open. Compare against a timezone */
export interface HoursTodayDto {
  isOpen: boolean;
  opensAt: string;
  closesAt: string;
  isOffHours?: boolean;
}

export interface LocationHourDto extends Partial<HourDto> {}
export interface LocationHoursTodayDto extends Partial<HoursTodayDto> {}
export interface LocationDeliveryHourDto extends Partial<HourDto> {}
export interface LocationDeliveryHourTodayDto extends Partial<HoursTodayDto> {}
