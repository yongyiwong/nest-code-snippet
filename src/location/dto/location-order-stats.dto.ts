import { ApiModelProperty } from '@nestjs/swagger';

export class LocationOrderStatsDto {
  @ApiModelProperty()
  locationId: number;
  @ApiModelProperty()
  date: Date;
  @ApiModelProperty()
  orderCount: number;
  @ApiModelProperty()
  fulfilledOrderCount: number;
}
