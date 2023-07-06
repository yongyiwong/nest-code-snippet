import { ApiModelProperty, ApiModelPropertyOptional } from '@nestjs/swagger';
import { Location } from '../../entities/location.entity';

export class UpdateProductDto {
  @ApiModelProperty()
  id: number;
  @ApiModelProperty()
  name: string;
  @ApiModelProperty()
  description: string;
  location: Location;

  @ApiModelPropertyOptional()
  category: string;
  @ApiModelPropertyOptional()
  subcategory: string;
  @ApiModelPropertyOptional()
  isInStock: boolean;
  @ApiModelPropertyOptional()
  strainId: number;
  @ApiModelPropertyOptional()
  strainName: string;

  @ApiModelProperty()
  createdBy: number;
  @ApiModelProperty()
  created: Date;
  @ApiModelProperty()
  modifiedBy: number;
}
