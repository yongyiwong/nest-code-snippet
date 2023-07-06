import { LocationCoupon } from '../../entities/location-coupon.entity';
import { LocationHoliday } from '../../entities/location-holiday.entity';
import { LocationHour } from '../../entities/location-hour.entity';
import { LocationPromotion } from '../../entities/location-promotion.entity';
import { LocationRating } from '../../entities/location-rating.entity';
import { Organization } from '../../entities/organization.entity';
import { Product } from '../../entities/product.entity';
import { State } from '../../entities/state.entity';
import {
  LocationHoursTodayDto,
  LocationDeliveryHourTodayDto,
} from './location-hour.dto';
import { LocationDeliveryHour } from '../../entities/location-delivery-hour.entity';
import { Location } from '../../entities/location.entity';

export interface LocationSearchDto extends Partial<Location> {
  id: number;
  name: string;
  posId?: number;
  thumbnail?: string;
  sitePhoto?: string;
  description?: string;
  longLat?: LongLatAsXY | string; // {x,y} or "(long,lat)"
  timezone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  organizationId?: number;
  organization?: Organization;
  locationCategory?: any;
  postalCode?: string;
  phoneNumber?: string;
  notificationMobileNumber?: string;
  notificationDeliveryMobileNumber?: string;
  isDeliveryAvailable: boolean;
  deliveryMileRadius?: number;
  deliveryFee?: number;
  deliveryFeePatientPercentage?: number;
  stateId?: number;
  state?: State; // abbreviation for state code
  rating?: number; // average rating for location
  ratingCount?: number;
  products?: Product[];
  ratings?: LocationRating[];
  promotions?: LocationPromotion[];
  coupons?: LocationCoupon[];
  created?: Date;
  createdBy?: number;
  modified?: Date;
  modifiedBy?: number;
  deleted?: boolean;
  hoursToday?: LocationHoursTodayDto;
  hours?: LocationHour[];
  holidays?: LocationHoliday[];
  distance?: number;
  url?: string;
  priority: number;
  deliveryHoursToday?: LocationDeliveryHourTodayDto;
  deliveryHours?: LocationDeliveryHour[];
  allowAfterHours?: boolean;
}

export interface LocationActiveDealsDto {
  id: number;
  name: string;
  orgId: number;
  orgActiveDealsCount: number;
  orgMaxActiveDeals: number;
}

export interface LongLatAsXY {
  x: number;
  y: number;
} // x = longitude, y = latitude;

export enum PricingType {
  Weight = 'weight',
  Unit = 'unit',
}
